import * as vscode from "vscode";
import { isConfigurationComplete } from "./configurationView";
import { WasmServer } from "./wasmServer";
import { DatabaseConfig, errorMessage } from "./wasmTypes";

let server: WasmServer | undefined;
let registrations: vscode.Disposable[] = [];
let restartTimeout: ReturnType<typeof setTimeout> | undefined;
let restarting = Promise.resolve();
let shuttingDown = false;

function getDatabaseConfig(): DatabaseConfig {
    const config = vscode.workspace.getConfiguration("singlestore");
    return {
        host: config.get<string>("host", "127.0.0.1"),
        port: config.get<number>("port", 3306),
        database: config.get<string>("databaseName", ""),
        username: config.get<string>("username", ""),
        password: config.get<string>("password", ""),
        ssl: config.get<boolean>("useSSL", false),
    };
}

function showError(message: string, error: unknown): void {
    void vscode.window.showErrorMessage(`SingleStore: ${message}. ${errorMessage(error)}`);
}

export async function refreshSchema(): Promise<void> {
    const current = server;
    if (!current) {
        void vscode.window.showErrorMessage("SingleStore: The local language server is not running.");
        return;
    }
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: "SingleStore: Refreshing database schema",
        }, () => current.request("refreshSchema", undefined));
        if (server === current) {
            vscode.window.setStatusBarMessage("SingleStore: Database schema refreshed", 3000);
        }
    } catch (error) {
        if (server === current) {
            showError("Could not refresh database schema; grammar completions remain available", error);
        }
    }
}

export async function startLanguageClient(): Promise<void> {
    if (server || shuttingDown) {
        return;
    }
    const configured = isConfigurationComplete();
    const current = new WasmServer(configured ? getDatabaseConfig() : undefined, error => {
        if (server === current) {
            showError("Local language server failed", error);
            void stopServer().catch(error => showError("Could not stop local language server", error));
        }
    });
    server = current;
    try {
        await current.request("initialize", undefined);
        if (server !== current) {
            return;
        }
        registrations = [
            vscode.languages.registerCompletionItemProvider([
                { scheme: "file", pattern: "**/*.s2db.sql" },
                { scheme: "untitled", pattern: "**/*.s2db.sql" },
            ], {
                async provideCompletionItems(document, position, token) {
                    try {
                        const version = document.version;
                        const result = await current.request("complete", {
                            uri: document.uri.toString(),
                            text: document.getText(),
                            version,
                            position: { line: position.line, character: position.character },
                        });
                        if (token.isCancellationRequested || document.version !== version) {
                            return;
                        }
                        return new vscode.CompletionList((result.completions ?? []).map(value => {
                            const item = new vscode.CompletionItem(value.label,
                                value.kind === undefined ? undefined : value.kind - 1);
                            item.detail = value.detail;
                            item.sortText = value.sortText || undefined;
                            item.filterText = value.filterText || undefined;
                            item.insertText = value.insertText || undefined;
                            item.preselect = value.preselect;
                            item.commitCharacters = value.commitChars ?? undefined;
                            if (value.deprecated) {
                                item.tags = [vscode.CompletionItemTag.Deprecated];
                            }
                            if (value.range) {
                                item.range = new vscode.Range(
                                    value.range.start.line, value.range.start.character,
                                    value.range.end.line, value.range.end.character
                                );
                            }
                            return item;
                        }), result.isIncomplete);
                    } catch (error) {
                        if (server === current && !token.isCancellationRequested) {
                            showError("Completion failed", error);
                        }
                        return;
                    }
                },
            }, ".", " ", "`"),
            vscode.workspace.onDidCloseTextDocument(document => {
                void current.request("close", { uri: document.uri.toString() }).catch(error => {
                    if (server === current) {
                        showError("Could not release document state", error);
                    }
                });
            }),
        ];
        vscode.window.setStatusBarMessage("SingleStore: Local WASM server ready", 3000);
        if (configured) {
            void refreshSchema();
        }
    } catch (error) {
        if (server === current) {
            showError("Could not start local language server", error);
            await stopServer();
        }
    }
}

export function updateDatabaseConfig(): void {
    if (restartTimeout) {
        clearTimeout(restartTimeout);
    }
    restartTimeout = setTimeout(() => {
        restartTimeout = undefined;
        restarting = restarting.then(async () => {
            await stopServer();
            await startLanguageClient();
        }).catch(error => showError("Could not restart local language server", error));
    }, 500);
}

export async function stopLanguageClient(): Promise<void> {
    shuttingDown = true;
    await stopServer();
}

async function stopServer(): Promise<void> {
    if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = undefined;
    }
    for (const registration of registrations) {
        registration.dispose();
    }
    registrations = [];
    const current = server;
    server = undefined;
    await current?.stop();
}
