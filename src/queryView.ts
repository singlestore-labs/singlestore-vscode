import * as vscode from "vscode";
import { ConnectionStore } from "./connectionStore";
import { QueryResultSet, QuerySession } from "./queryExecution";
import { statementAtCursor, statementsInSelection } from "./sqlStatements";

interface HistoryEntry {
    sql: string;
    connection: string;
    time: Date;
}

class HistoryItem extends vscode.TreeItem {
    constructor(readonly entry: HistoryEntry) {
        super(entry.sql.replace(/\s+/g, " ").trim(), vscode.TreeItemCollapsibleState.None);
        this.description = `${entry.connection} · ${entry.time.toLocaleTimeString()}`;
        this.tooltip = `${entry.connection}\n${entry.time.toLocaleString()}\n\n${entry.sql}`;
        this.iconPath = new vscode.ThemeIcon("history");
        this.command = { command: "singlestore.rerunQuery", title: "Run Query", arguments: [this] };
        this.contextValue = "singlestoreQueryHistory";
    }
}

interface RunEntry {
    sql: string;
    results?: QueryResultSet[];
    error?: string;
}

export class QueryView implements vscode.TreeDataProvider<HistoryItem>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<HistoryItem | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    private readonly history: HistoryEntry[] = [];
    private session: QuerySession | undefined;
    private sessionProfileId: string | undefined;
    private running = false;
    private generation = 0;

    constructor(private readonly store: ConnectionStore) {}

    getTreeItem(item: HistoryItem): vscode.TreeItem { return item; }
    getChildren(): HistoryItem[] { return this.history.map(entry => new HistoryItem(entry)); }

    clearHistory(): void {
        this.history.length = 0;
        this.emitter.fire(undefined);
    }

    async runEditor(mode: "selection" | "cursor" | "auto"): Promise<void> {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) throw new Error("Open a SQL editor first.");
            const selection = editor.selection;
            const text = editor.document.getText();
            const start = editor.document.offsetAt(selection.start);
            const end = editor.document.offsetAt(selection.end);
            const useSelection = mode === "selection" || (mode === "auto" && start !== end);
            if (useSelection && start === end) throw new Error("Select SQL to execute.");
            const statements = useSelection
                ? statementsInSelection(text, start, end)
                : [statementAtCursor(text, editor.document.offsetAt(selection.active))].filter(
                    (statement): statement is NonNullable<typeof statement> => !!statement
                );
            if (!statements.length) throw new Error("No SQL statement found.");
            await this.run(statements.map(statement => statement.sql));
        } catch (error) {
            showError(error);
        }
    }

    async rerun(item?: HistoryItem): Promise<void> {
        if (!item) {
            void vscode.window.showInformationMessage("Select a query in SingleStore Query History.");
            return;
        }
        try {
            await this.run([item.entry.sql]);
        } catch (error) {
            showError(error);
        }
    }

    private async run(statements: string[]): Promise<void> {
        if (this.running) throw new Error("A SingleStore query is already running.");
        const profile = this.store.getActiveProfile();
        if (!profile) throw new Error("Connect to a SingleStore profile first.");
        const limit = vscode.workspace.getConfiguration("singlestore").get<number>("queryRowLimit", 200);
        if (!Number.isSafeInteger(limit) || limit < 1) {
            throw new Error("Set SingleStore query row limit to a positive integer.");
        }
        this.running = true;
        const generation = this.generation;
        let panel: vscode.WebviewPanel | undefined;
        const entries: RunEntry[] = [];
        try {
            if (this.session?.failure) {
                const detail = this.session.failure instanceof Error ? this.session.failure.message : String(this.session.failure);
                this.invalidateConnection();
                throw new Error(`The query session was lost: ${detail}. Retry to open a new session.`);
            }
            if (this.session && this.sessionProfileId !== profile.id) this.invalidateConnection();
            let session = this.session;
            if (!session) {
                const config = await this.store.getDatabaseConfig(profile.id);
                if (generation !== this.generation || this.store.getActiveProfileId() !== profile.id) {
                    throw new Error("The active connection changed before the query started.");
                }
                session = new QuerySession(config);
                this.session = session;
                this.sessionProfileId = profile.id;
            }
            panel = vscode.window.createWebviewPanel(
                "singlestoreQueryResults", `SingleStore Results: ${profile.name}`,
                vscode.ViewColumn.Beside, { enableScripts: false }
            );
            const update = () => {
                if (panel) panel.webview.html = resultHtml(profile.name, entries, limit);
            };
            panel.onDidDispose(() => { panel = undefined; });
            update();
            if (generation !== this.generation) throw new Error("The active connection changed before the query started.");
            if (!this.sessionConnected) {
                try {
                    await session.connect();
                    this.sessionConnected = true;
                } catch (error) {
                    this.invalidateConnection();
                    throw error;
                }
            }
            for (const sql of statements) {
                if (generation !== this.generation) throw new Error("The active connection changed during execution.");
                const entry: RunEntry = { sql };
                entries.push(entry);
                this.history.unshift({ sql, connection: profile.name, time: new Date() });
                this.emitter.fire(undefined);
                update();
                try {
                    entry.results = await session.execute(sql, limit);
                } catch (error) {
                    entry.error = error instanceof Error ? error.message : String(error);
                    update();
                    throw error;
                }
                update();
            }
        } catch (error) {
            if (panel && !entries.length) {
                entries.push({ sql: "", error: error instanceof Error ? error.message : String(error) });
                panel.webview.html = resultHtml(profile.name, entries, limit);
            }
            throw error;
        } finally {
            this.running = false;
        }
    }

    private sessionConnected = false;

    invalidateConnection(): void {
        this.generation++;
        this.session?.dispose();
        this.session = undefined;
        this.sessionProfileId = undefined;
        this.sessionConnected = false;
    }

    dispose(): void {
        this.invalidateConnection();
        this.emitter.dispose();
    }
}

function showError(error: unknown): void {
    void vscode.window.showErrorMessage(`SingleStore: ${error instanceof Error ? error.message : String(error)}`);
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]!));
}

function resultHtml(connection: string, entries: RunEntry[], limit: number): string {
    const body = entries.map((entry, index) => {
        const results = entry.results?.map((result, resultIndex) => {
            if (result.affectedRows !== undefined) {
                return `<p>Result ${resultIndex + 1}: ${result.affectedRows} rows affected.</p>`;
            }
            const headers = result.columns.map(column => `<th>${escapeHtml(column)}</th>`).join("");
            const rows = result.rows.map(row => `<tr>${row.map(value =>
                `<td>${value === null ? "<em>NULL</em>" : escapeHtml(String(value))}</td>`
            ).join("")}</tr>`).join("");
            const truncated = result.totalRows > limit ? ` (limited to ${limit})` : "";
            return `<p>Result ${resultIndex + 1}: ${result.totalRows} rows returned${truncated}.</p>
                <div class="table"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
        }).join("") ?? "";
        return `<section><h2>Query ${index + 1}</h2><pre>${escapeHtml(entry.sql)}</pre>
            ${entry.error ? `<p class="error">${escapeHtml(entry.error)}</p>` : results || "<p>Running…</p>"}</section>`;
    }).join("");
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
        <meta name="viewport" content="width=device-width, initial-scale=1.0"><title>SingleStore Results</title>
        <style>
        body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); padding: 1em; }
        pre { white-space: pre-wrap; overflow-wrap: anywhere; }
        .table { overflow: auto; } table { border-collapse: collapse; }
        th, td { padding: .4em .7em; border: 1px solid var(--vscode-panel-border); text-align: left; white-space: pre-wrap; }
        th { background: var(--vscode-editor-background); } .error { color: var(--vscode-errorForeground); }
        </style></head><body><h1>Results: ${escapeHtml(connection)}</h1>${body || "<p>Connecting…</p>"}</body></html>`;
}
