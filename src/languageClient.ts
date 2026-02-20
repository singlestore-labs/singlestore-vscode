import * as net from "net";
import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    StreamInfo,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let restartTimeout: NodeJS.Timeout | undefined;

interface DatabaseConfig {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl: boolean;
}

interface ClientConfig {
    name: string;
    version: string;
}

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

function getClientConfiguration(): ClientConfig {
    const ext = vscode.extensions.getExtension("singlestore.singlestore-vscode");
    return {
        name: ext?.packageJSON.displayName ?? "SingleStore VSCode Extension",
        version: ext?.packageJSON.version ?? "0.0.0",
    };
}

function getLanguageServerAddress(): { host: string; port: number } {
    const config = vscode.workspace.getConfiguration("singlestore");
    const address = config.get<string>("languageServerAddress", "127.0.0.1:4040");
    const parts = address.split(":");
    return {
        host: parts[0] || "127.0.0.1",
        port: parseInt(parts[1], 10) || 4040,
    };
}

function createServerConnection(): () => Promise<StreamInfo> {
    return () => {
        const { host, port } = getLanguageServerAddress();
        return new Promise((resolve, reject) => {
            const socket = net.connect({ host, port }, () => {
                resolve({
                    reader: socket,
                    writer: socket,
                });
            });
            socket.on("error", (err) => {
                reject(err);
            });
        });
    };
}

export async function startLanguageClient(): Promise<void> {
    if (client) {
        return;
    }

    const documentSelector = [
        { scheme: "file", pattern: "**/*.s2db.sql" },
        { scheme: "untitled", pattern: "**/*.s2db.sql" },
    ];

    const clientOptions: LanguageClientOptions = {
        documentSelector,
        initializationOptions: {
            database: getDatabaseConfig(),
            client: getClientConfiguration(),
        },
        diagnosticCollectionName: "singlestore",
    };

    client = new LanguageClient(
        "singlestoreLSP",
        "SingleStore Language Server",
        createServerConnection(),
        clientOptions
    );

    try {
        await client.start();
        vscode.window.setStatusBarMessage("SingleStore LSP: Connected", 3000);
    } catch (err: any) {
        vscode.window.showErrorMessage(
            `SingleStore LSP: Failed to connect to the language server. ${err.message || err}`
        );
        client = undefined;
    }
}

export async function stopLanguageClient(): Promise<void> {
    if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = undefined;
    }
    if (client) {
        try {
            await client.stop();
        } catch {
            // ignore errors during stop
        }
        client = undefined;
    }
}

export function scheduleRestart(): void {
    // Debounce restarts to avoid rapid cycling when multiple settings change at once
    if (restartTimeout) {
        clearTimeout(restartTimeout);
    }
    restartTimeout = setTimeout(async () => {
        restartTimeout = undefined;
        await stopLanguageClient();
        await startLanguageClient();
    }, 500);
}

export function isClientRunning(): boolean {
    return client !== undefined;
}
