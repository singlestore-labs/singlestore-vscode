import * as vscode from "vscode";
import { isConfigurationComplete } from "./configurationView";
import { WasmServer } from "./wasmServer";
import { DatabaseConfig, errorMessage } from "./wasmTypes";
import { completionPattern, getFilePattern } from "./fileAssociation";
import { DEFAULT_SCHEMA_REFRESH_MINUTES, isSchemaRefreshInterval } from "./schemaRefreshConfig";

let server: WasmServer | undefined;
let registrations: vscode.Disposable[] = [];
let completionRegistration: vscode.Disposable | undefined;
let completionProvider: vscode.CompletionItemProvider | undefined;
let restartTimeout: ReturnType<typeof setTimeout> | undefined;
let restarting = Promise.resolve();
let shuttingDown = false;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let refreshConfigured = false;
let activeRefresh: { server: WasmServer; promise: Promise<void>; showProgress: boolean } | undefined;
let automaticRefreshFailed = false;

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
    await refreshDatabaseSchema(true);
}

async function refreshDatabaseSchema(showProgress: boolean): Promise<void> {
    const current = server;
    if (!current) {
        if (showProgress) {
            void vscode.window.showErrorMessage("SingleStore: The local language server is not running.");
        }
        return;
    }
    if (!activeRefresh || activeRefresh.server !== current) {
        activeRefresh = { server: current, promise: current.request("refreshSchema", undefined), showProgress };
    }
    const refresh = activeRefresh;
    refresh.showProgress ||= showProgress;
    try {
        if (showProgress) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: "SingleStore: Refreshing database schema",
            }, () => refresh.promise);
        } else {
            await refresh.promise;
        }
        if (server === current) {
            automaticRefreshFailed = false;
            if (showProgress) {
                vscode.window.setStatusBarMessage("SingleStore: Database schema refreshed", 3000);
            }
        }
    } catch (error) {
        if (server === current) {
            if (!showProgress) {
                console.error("SingleStore: Automatic schema refresh failed:", error);
            }
            if (showProgress || (!refresh.showProgress && !automaticRefreshFailed)) {
                showError("Could not refresh database schema; grammar completions remain available", error);
            }
            automaticRefreshFailed = true;
        }
    } finally {
        if (activeRefresh === refresh) {
            activeRefresh = undefined;
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
        completionProvider = {
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
        };
        updateFilePattern();
        registrations = [
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
            refreshConfigured = true;
            updateSchemaRefreshInterval();
        }
    } catch (error) {
        if (server === current) {
            showError("Could not start local language server", error);
            await stopServer();
        }
    }
}

export function updateSchemaRefreshInterval(): void {
    if (refreshTimer !== undefined) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }
    const current = server;
    if (!current || !refreshConfigured) {
        return;
    }
    const interval = vscode.workspace.getConfiguration("singlestore")
        .get<unknown>("schemaRefreshInterval", DEFAULT_SCHEMA_REFRESH_MINUTES);
    if (!isSchemaRefreshInterval(interval)) {
        showError("Invalid schema refresh interval", "Choose 1, 5, 30, 60, or 0 (never) minutes in settings.");
        return;
    }
    if (interval === 0) {
        return;
    }
    const timer = setInterval(() => {
        if (refreshTimer === timer && server === current && !activeRefresh) {
            void refreshDatabaseSchema(false);
        }
    }, interval * 60 * 1000);
    refreshTimer = timer;
}

export function updateFilePattern(): void {
    try {
        const pattern = completionPattern(getFilePattern());
        if (!completionProvider) {
            return;
        }
        const registration = vscode.languages.registerCompletionItemProvider([
            { scheme: "file", pattern },
            { scheme: "untitled", pattern },
        ], completionProvider, ".", " ", "`");
        completionRegistration?.dispose();
        completionRegistration = registration;
    } catch (error) {
        showError("Could not apply file pattern", error);
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
    if (refreshTimer !== undefined) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
    }
    automaticRefreshFailed = false;
    refreshConfigured = false;
    activeRefresh = undefined;
    if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = undefined;
    }
    for (const registration of registrations) {
        registration.dispose();
    }
    registrations = [];
    completionRegistration?.dispose();
    completionRegistration = undefined;
    completionProvider = undefined;
    const current = server;
    server = undefined;
    await current?.stop();
}
