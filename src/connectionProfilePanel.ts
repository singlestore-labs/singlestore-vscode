import * as vscode from "vscode";
import { ConnectionProfile } from "./connectionStore";

export interface ConnectionProfileFormData {
    name: string;
    host: string;
    port: number;
    username: string;
    databaseName: string;
    useSSL: boolean;
    password: string;
    clearPassword: boolean;
}

export class ConnectionProfilePanel {
    private static currentPanel: ConnectionProfilePanel | undefined;

    private readonly disposables: vscode.Disposable[] = [];
    private onSave: (data: ConnectionProfileFormData) => Promise<void>;
    private onTest: (data: ConnectionProfileFormData) => Promise<void>;
    private formGeneration = 0;

    static createOrShow(
        profile: ConnectionProfile | undefined,
        onSave: (data: ConnectionProfileFormData) => Promise<void>,
        onTest: (data: ConnectionProfileFormData) => Promise<void>
    ): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (ConnectionProfilePanel.currentPanel) {
            ConnectionProfilePanel.currentPanel.onSave = onSave;
            ConnectionProfilePanel.currentPanel.onTest = onTest;
            ConnectionProfilePanel.currentPanel.panel.reveal(column);
            ConnectionProfilePanel.currentPanel.update(profile);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            "singlestoreConnectionProfile",
            profile ? "Edit SingleStore Connection" : "Add SingleStore Connection",
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        ConnectionProfilePanel.currentPanel = new ConnectionProfilePanel(panel, profile, onSave, onTest);
    }

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        profile: ConnectionProfile | undefined,
        onSave: (data: ConnectionProfileFormData) => Promise<void>,
        onTest: (data: ConnectionProfileFormData) => Promise<void>
    ) {
        this.onSave = onSave;
        this.onTest = onTest;
        panel.onDidDispose(() => this.dispose(), null, this.disposables);
        panel.webview.onDidReceiveMessage(message => {
            if (message.command === "save") {
                void this.save(message.data);
            } else if (message.command === "test") {
                void this.test(message.data);
            } else if (message.command === "cancel") {
                panel.dispose();
            }
        }, null, this.disposables);
        this.update(profile);
    }

    private async save(value: unknown): Promise<void> {
        try {
            const data = parseFormData(value, true);
            await this.onSave(data);
            await this.panel.webview.postMessage({ command: "saved" });
            this.panel.dispose();
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            await this.panel.webview.postMessage({ command: "saveError", message: detail });
        }
    }

    private async test(value: unknown): Promise<void> {
        const generation = this.formGeneration;
        let result: { command: string; ok: boolean; message: string };
        try {
            await this.onTest(parseFormData(value, false));
            result = { command: "testResult", ok: true, message: "Connection succeeded." };
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            result = { command: "testResult", ok: false, message: `Connection failed: ${detail}` };
        }
        if (generation === this.formGeneration) {
            await this.panel.webview.postMessage(result);
        }
    }

    private update(profile: ConnectionProfile | undefined): void {
        this.formGeneration++;
        this.panel.title = profile ? "Edit SingleStore Connection" : "Add SingleStore Connection";
        this.panel.webview.html = this.getHtml(profile);
    }

    private getHtml(profile: ConnectionProfile | undefined): string {
        const nonce = getNonce();
        const initial = {
            name: profile?.name ?? "",
            host: profile?.host ?? "127.0.0.1",
            port: profile?.port ?? 3306,
            username: profile?.username ?? "",
            databaseName: profile?.databaseName ?? "",
            useSSL: profile?.useSSL ?? false,
            editing: Boolean(profile),
        };
        const safeInitial = JSON.stringify(initial).replace(/</g, "\\u003c");

        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SingleStore Connection</title>
    <style nonce="${nonce}">
        body {
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            max-width: 640px;
            margin: 0 auto;
            padding: 28px 32px;
        }
        h1 { font-size: 1.4em; margin: 0 0 8px; }
        .subtitle { color: var(--vscode-descriptionForeground); margin: 0 0 24px; }
        .field { margin: 0 0 16px; }
        label { display: block; font-weight: 600; margin-bottom: 5px; }
        input[type="text"], input[type="number"], input[type="password"] {
            box-sizing: border-box;
            width: 100%;
            padding: 7px 9px;
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border, transparent);
            font: inherit;
        }
        input:focus { outline: 1px solid var(--vscode-focusBorder); }
        .hint { margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: .9em; }
        .checkbox { display: flex; align-items: center; gap: 8px; }
        .checkbox label { margin: 0; }
        .error {
            display: none;
            padding: 8px 10px;
            margin-bottom: 16px;
            color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
        }
        .status {
            display: none;
            padding: 8px 10px;
            margin-top: 16px;
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            background: var(--vscode-inputValidation-infoBackground);
            overflow-wrap: anywhere;
        }
        .status.success { border-color: var(--vscode-testing-iconPassed, var(--vscode-charts-green)); }
        .status.failure {
            border-color: var(--vscode-inputValidation-errorBorder);
            background: var(--vscode-inputValidation-errorBackground);
        }
        .actions { display: flex; gap: 8px; margin-top: 24px; }
        button {
            padding: 7px 14px;
            color: var(--vscode-button-foreground);
            background: var(--vscode-button-background);
            border: 0;
            font: inherit;
            cursor: pointer;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button.secondary {
            color: var(--vscode-button-secondaryForeground);
            background: var(--vscode-button-secondaryBackground);
        }
        button:disabled { opacity: .6; cursor: wait; }
        [hidden] { display: none !important; }
    </style>
</head>
<body>
    <h1 id="heading"></h1>
    <p class="subtitle">Connection details are saved locally. Passwords are protected by VS Code SecretStorage.</p>
    <div id="error" class="error" role="alert"></div>
    <form id="form">
        <div class="field">
            <label for="name">Connection name</label>
            <input id="name" type="text" autocomplete="off" required />
        </div>
        <div class="field">
            <label for="host">Host</label>
            <input id="host" type="text" autocomplete="off" required />
        </div>
        <div class="field">
            <label for="port">Port</label>
            <input id="port" type="number" min="1" max="65535" step="1" required />
        </div>
        <div class="field">
            <label for="username">Username</label>
            <input id="username" type="text" autocomplete="username" required />
        </div>
        <div class="field">
            <label for="password">Password</label>
            <input id="password" type="password" autocomplete="new-password" />
            <div id="passwordHint" class="hint"></div>
            <div id="clearPasswordField" class="checkbox" hidden>
                <input id="clearPassword" type="checkbox" />
                <label for="clearPassword">Remove saved password</label>
            </div>
        </div>
        <div class="field">
            <label for="databaseName">Database</label>
            <input id="databaseName" type="text" autocomplete="off" />
            <div class="hint">Optional. Leave blank to connect without selecting a database.</div>
        </div>
        <div class="field checkbox">
            <input id="useSSL" type="checkbox" />
            <label for="useSSL">Use SSL</label>
        </div>
        <div class="actions">
            <button id="save" type="submit">Save connection</button>
            <button id="test" class="secondary" type="button">Test connection</button>
            <button id="cancel" class="secondary" type="button">Cancel</button>
        </div>
        <div id="testStatus" class="status" role="status" aria-live="polite"></div>
    </form>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const initial = ${safeInitial};
        const byId = id => document.getElementById(id);
        byId('heading').textContent = initial.editing ? 'Edit connection' : 'Add connection';
        for (const key of ['name', 'host', 'port', 'username', 'databaseName']) {
            byId(key).value = initial[key];
        }
        byId('useSSL').checked = initial.useSSL;
        byId('passwordHint').textContent = initial.editing
            ? 'Leave blank to keep the current password.'
            : 'Optional; leave blank for passwordless authentication.';
        byId('clearPasswordField').hidden = !initial.editing;
        function readForm() {
            const port = Number(byId('port').value);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                byId('error').textContent = 'Port must be an integer between 1 and 65535.';
                byId('error').style.display = 'block';
                return undefined;
            }
            byId('error').style.display = 'none';
            return {
                name: byId('name').value.trim(),
                host: byId('host').value.trim(),
                port,
                username: byId('username').value.trim(),
                password: byId('password').value,
                databaseName: byId('databaseName').value.trim(),
                useSSL: byId('useSSL').checked,
                clearPassword: byId('clearPassword').checked,
            };
        }
        function showStatus(text, state) {
            const status = byId('testStatus');
            status.textContent = text;
            status.className = 'status' + (state ? ' ' + state : '');
            status.style.display = 'block';
        }
        byId('form').addEventListener('submit', event => {
            event.preventDefault();
            const data = readForm();
            if (!data) return;
            byId('save').disabled = true;
            vscode.postMessage({ command: 'save', data });
        });
        byId('test').addEventListener('click', () => {
            const data = readForm();
            if (!data) return;
            if (!data.host || !data.username) {
                byId('error').textContent = 'Host and username are required to test the connection.';
                byId('error').style.display = 'block';
                return;
            }
            byId('test').disabled = true;
            showStatus('Testing connection…', '');
            vscode.postMessage({ command: 'test', data });
        });
        byId('cancel').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
        window.addEventListener('message', event => {
            if (event.data.command === 'saved') return;
            if (event.data.command === 'testResult') {
                byId('test').disabled = false;
                showStatus(event.data.message, event.data.ok ? 'success' : 'failure');
                return;
            }
            byId('save').disabled = false;
            byId('error').textContent = event.data.message || 'Could not save this connection.';
            byId('error').style.display = 'block';
        });
        window.addEventListener('keydown', event => {
            if (event.key === 'Escape') vscode.postMessage({ command: 'cancel' });
        });
    </script>
</body>
</html>`;
    }

    private dispose(): void {
        ConnectionProfilePanel.currentPanel = undefined;
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }
}

function parseFormData(value: unknown, requireName: boolean): ConnectionProfileFormData {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Connection details are missing.");
    }
    const data = value as Record<string, unknown>;
    if (typeof data.name !== "string" || (requireName && !data.name.trim()) ||
        typeof data.host !== "string" || !data.host.trim() ||
        typeof data.username !== "string" || !data.username.trim()) {
        throw new Error(requireName
            ? "Connection name, host, and username are required."
            : "Host and username are required.");
    }
    if (typeof data.port !== "number" || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535) {
        throw new Error("Port must be an integer between 1 and 65535.");
    }
    if (typeof data.databaseName !== "string" || typeof data.password !== "string" ||
        typeof data.useSSL !== "boolean" || typeof data.clearPassword !== "boolean") {
        throw new Error("Some connection fields have invalid values.");
    }
    return {
        name: data.name.trim(),
        host: data.host.trim(),
        port: data.port,
        username: data.username.trim(),
        databaseName: data.databaseName.trim(),
        password: data.password,
        useSSL: data.useSSL,
        clearPassword: data.clearPassword,
    };
}

function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
