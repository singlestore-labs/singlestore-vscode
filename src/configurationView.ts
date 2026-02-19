import * as vscode from "vscode";

/**
 * Checks whether the required connection fields (host, username, password) are filled in.
 */
export function isConfigurationComplete(): boolean {
    const config = vscode.workspace.getConfiguration("singlestore");
    const host = config.get<string>("host", "").trim();
    const username = config.get<string>("username", "").trim();
    const password = config.get<string>("password", "").trim();
    return host.length > 0 && username.length > 0 && password.length > 0;
}

export class ConnectionConfigPanel {
    public static currentPanel: ConnectionConfigPanel | undefined;
    public static readonly viewType = "singlestoreConnectionConfig";

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _onConfigSaved: (() => void) | undefined;

    public static createOrShow(
        extensionUri: vscode.Uri,
        onConfigSaved?: () => void
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ConnectionConfigPanel.currentPanel) {
            ConnectionConfigPanel.currentPanel._onConfigSaved = onConfigSaved;
            ConnectionConfigPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ConnectionConfigPanel.viewType,
            "SingleStore LSP Connection",
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        ConnectionConfigPanel.currentPanel = new ConnectionConfigPanel(
            panel,
            extensionUri,
            onConfigSaved
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        onConfigSaved?: () => void
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._onConfigSaved = onConfigSaved;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case "saveConfig":
                        await this._saveConfiguration(message.data);
                        vscode.window.showInformationMessage(
                            "SingleStore LSP Connection configuration saved."
                        );
                        if (this._onConfigSaved) {
                            this._onConfigSaved();
                        }
                        return;
                    case "loadConfig":
                        this._sendCurrentConfig();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private async _saveConfiguration(data: {
        host: string;
        port: number;
        username: string;
        password: string;
        databaseName: string;
        useSSL: boolean;
        languageServerAddress: string;
    }) {
        const config = vscode.workspace.getConfiguration("singlestore");
        await config.update("host", data.host, vscode.ConfigurationTarget.Global);
        await config.update("port", data.port, vscode.ConfigurationTarget.Global);
        await config.update("username", data.username, vscode.ConfigurationTarget.Global);
        await config.update("password", data.password, vscode.ConfigurationTarget.Global);
        await config.update("databaseName", data.databaseName, vscode.ConfigurationTarget.Global);
        await config.update("useSSL", data.useSSL, vscode.ConfigurationTarget.Global);
        await config.update("languageServerAddress", data.languageServerAddress, vscode.ConfigurationTarget.Global);
    }

    private _sendCurrentConfig() {
        const config = vscode.workspace.getConfiguration("singlestore");
        this._panel.webview.postMessage({
            command: "configLoaded",
            data: {
                host: config.get<string>("host", "127.0.0.1"),
                port: config.get<number>("port", 3306),
                username: config.get<string>("username", ""),
                password: config.get<string>("password", ""),
                databaseName: config.get<string>("databaseName", ""),
                useSSL: config.get<boolean>("useSSL", false),
                languageServerAddress: config.get<string>("languageServerAddress", "127.0.0.1:4040"),
            },
        });
    }

    public dispose() {
        ConnectionConfigPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) {
                d.dispose();
            }
        }
    }

    private _update() {
        this._panel.title = "SingleStore LSP Connection";
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const nonce = getNonce();

        const logoUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "icons", "singlestore_logo_horizontal_color_on-white_rgb.png")
        );

        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src ${this._panel.webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SingleStore LSP Connection</title>
    <style nonce="${nonce}">
        :root {
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border, transparent);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover: var(--vscode-button-hoverBackground);
            --focus-border: var(--vscode-focusBorder);
            --font: var(--vscode-font-family);
            --font-size: var(--vscode-font-size);
        }

        body {
            font-family: var(--font);
            font-size: var(--font-size);
            padding: 20px 30px;
            color: var(--vscode-foreground);
            max-width: 500px;
        }

        h1 {
            font-size: 1.4em;
            margin-bottom: 4px;
            font-weight: 600;
        }

        .subtitle {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 24px;
            font-size: 0.95em;
        }

        .form-group {
            margin-bottom: 16px;
        }

        label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
            font-size: 0.95em;
        }

        input[type="text"],
        input[type="number"],
        input[type="password"] {
            width: 100%;
            box-sizing: border-box;
            padding: 6px 8px;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 2px;
            font-family: var(--font);
            font-size: var(--font-size);
            outline: none;
        }

        input[type="text"]:focus,
        input[type="number"]:focus,
        input[type="password"]:focus {
            border-color: var(--focus-border);
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
        }

        .checkbox-group label {
            margin-bottom: 0;
            cursor: pointer;
        }

        input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
            accent-color: var(--button-bg);
        }

        .actions {
            margin-top: 24px;
            display: flex;
            gap: 10px;
        }

        button {
            padding: 8px 16px;
            background: var(--button-bg);
            color: var(--button-fg);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-family: var(--font);
            font-size: var(--font-size);
            font-weight: 500;
        }

        button:hover {
            background: var(--button-hover);
        }

        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .description {
            color: var(--vscode-descriptionForeground);
            font-size: 0.85em;
            margin-top: 2px;
        }

        .logo {
            max-width: 280px;
            margin-bottom: 16px;
            display: block;
        }

        body.vscode-dark .logo,
        body.vscode-high-contrast .logo {
            filter: invert(1) hue-rotate(180deg);
        }
    </style>
</head>
<body>
    <img src="${logoUri}" alt="SingleStore" class="logo" />
    <h1>SingleStore LSP Connection</h1>
    <p class="subtitle">The configuration will be passed to the language server.
    Configure your database connection credentials before using the extension.</p>

    <div id="validationMsg" style="display:none; padding:8px 12px; margin-bottom:16px; border-radius:3px;
        background:var(--vscode-inputValidation-warningBackground);
        border:1px solid var(--vscode-inputValidation-warningBorder);
        color:var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        font-size:0.9em;"></div>

    <form id="configForm">
        <div class="form-group">
            <label for="host">Host</label>
            <input type="text" id="host" placeholder="e.g. 127.0.0.1" />
            <div class="description">The hostname or IP address of the SingleStore server.</div>
        </div>

        <div class="form-group">
            <label for="port">Port</label>
            <input type="number" id="port" min="1" max="65535" placeholder="e.g. 3306" />
            <div class="description">The port number for the database connection.</div>
        </div>

        <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" placeholder="Enter username" />
        </div>

        <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" placeholder="Enter password" />
        </div>

        <div class="form-group">
            <label for="databaseName">Database Name</label>
            <input type="text" id="databaseName" placeholder="Enter database name" />
            <div class="description">The name of the SingleStore database to connect to.</div>
        </div>

        <div class="form-group">
            <div class="checkbox-group">
                <input type="checkbox" id="useSSL" />
                <label for="useSSL">Use SSL</label>
            </div>
            <div class="description">Enable SSL encryption for the connection.</div>
        </div>

        <div class="form-group">
            <label for="languageServerAddress">Language Server TCP Address</label>
            <input type="text" id="languageServerAddress" placeholder="e.g. 127.0.0.1:4040" />
            <div class="description">The TCP address (host:port) of the language server.</div>
        </div>

        <div class="actions">
            <button type="submit">Save</button>
            <button type="button" class="secondary" id="resetBtn">Reset</button>
        </div>
    </form>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        const hostInput = document.getElementById('host');
        const portInput = document.getElementById('port');
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const databaseNameInput = document.getElementById('databaseName');
        const useSSLInput = document.getElementById('useSSL');
        const languageServerAddressInput = document.getElementById('languageServerAddress');
        const form = document.getElementById('configForm');
        const resetBtn = document.getElementById('resetBtn');

        // Load current configuration on start
        vscode.postMessage({ command: 'loadConfig' });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'configLoaded') {
                const data = message.data;
                hostInput.value = data.host || '';
                portInput.value = data.port || '';
                usernameInput.value = data.username || '';
                passwordInput.value = data.password || '';
                databaseNameInput.value = data.databaseName || '';
                useSSLInput.checked = data.useSSL || false;
                languageServerAddressInput.value = data.languageServerAddress || '';
            }
        });

        const validationMsg = document.getElementById('validationMsg');

        function validate() {
            const missing = [];
            if (!hostInput.value.trim()) missing.push('Host');
            if (!usernameInput.value.trim()) missing.push('Username');
            if (!passwordInput.value.trim()) missing.push('Password');
            return missing;
        }

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const missing = validate();
            if (missing.length > 0) {
                validationMsg.textContent = 'Required fields missing: ' + missing.join(', ');
                validationMsg.style.display = 'block';
                return;
            }
            validationMsg.style.display = 'none';
            vscode.postMessage({
                command: 'saveConfig',
                data: {
                    host: hostInput.value.trim(),
                    port: parseInt(portInput.value, 10) || 3306,
                    username: usernameInput.value.trim(),
                    password: passwordInput.value.trim(),
                    databaseName: databaseNameInput.value.trim(),
                    useSSL: useSSLInput.checked,
                    languageServerAddress: languageServerAddressInput.value.trim(),
                },
            });
        });

        resetBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'loadConfig' });
        });
    </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
