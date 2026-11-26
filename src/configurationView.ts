import * as vscode from "vscode";
import { DEFAULT_FILE_PATTERN } from "./fileAssociation";
import { DEFAULT_SCHEMA_REFRESH_MINUTES, isSchemaRefreshInterval } from "./schemaRefreshConfig";
import { getSemanticColors, saveSemanticColors, SEMANTIC_TOKEN_TYPES } from "./semanticColors";

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
            "SingleStore Preferences",
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
                        try {
                            await this._saveConfiguration(message.data);
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            void vscode.window.showErrorMessage(`SingleStore: Could not save configuration. ${message}`);
                            return;
                        }
                        vscode.window.showInformationMessage(
                            "SingleStore database connection configuration saved."
                        );
                        void this._panel.webview.postMessage({
                            command: "semanticColorsSaved",
                            colors: getSemanticColors(),
                        });
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
        filePattern: string;
        schemaRefreshInterval: number;
        semanticColors: Record<string, string>;
    }) {
        const pattern = typeof data.filePattern === "string" ? data.filePattern.trim() : "";
        if (!pattern || pattern.includes("\\")) {
            throw new Error("The file pattern must be a non-empty VS Code glob using / as the path separator.");
        }
        if (!isSchemaRefreshInterval(data.schemaRefreshInterval)) {
            throw new Error("Choose a valid schema refresh interval.");
        }
        await saveSemanticColors(data.semanticColors);
        const config = vscode.workspace.getConfiguration("singlestore");
        await config.update("filePattern", pattern, vscode.ConfigurationTarget.Global);
        await config.update("schemaRefreshInterval", data.schemaRefreshInterval, vscode.ConfigurationTarget.Global);
    }

    private _sendCurrentConfig() {
        const config = vscode.workspace.getConfiguration("singlestore");
        this._panel.webview.postMessage({
            command: "configLoaded",
            data: {
                filePattern: config.get<string>("filePattern", DEFAULT_FILE_PATTERN),
                schemaRefreshInterval: config.get<number>("schemaRefreshInterval", DEFAULT_SCHEMA_REFRESH_MINUTES),
                semanticColors: getSemanticColors(),
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
        this._panel.title = "SingleStore Preferences";
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
    <title>SingleStore Preferences</title>
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
        input[type="password"],
        select {
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
        input[type="password"]:focus,
        select:focus {
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

        .semantic-color-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }

        .semantic-color-row label {
            flex: 1;
            margin: 0;
        }

        .semantic-color-row input[type="text"] {
            width: 110px;
        }

        .semantic-color-row input[type="color"] {
            width: 36px;
            height: 30px;
            padding: 0;
            border: 0;
            cursor: pointer;
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
    <h1>SingleStore Preferences</h1>
    <p class="subtitle">Customize SQL file matching, schema refresh, and semantic token colors.</p>

    <div id="validationMsg" style="display:none; padding:8px 12px; margin-bottom:16px; border-radius:3px;
        background:var(--vscode-inputValidation-warningBackground);
        border:1px solid var(--vscode-inputValidation-warningBorder);
        color:var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        font-size:0.9em;"></div>

    <form id="configForm">
        <div class="form-group">
            <label for="filePatternChoice">Files for SingleStore completions</label>
            <select id="filePatternChoice">
                <option value="*.s2db.sql">SingleStore SQL (*.s2db.sql)</option>
                <option value="*.sql">All SQL files (*.sql)</option>
                <option value="custom">Custom pattern</option>
            </select>
            <input type="text" id="customFilePattern" placeholder="e.g. **/queries/*.sql" aria-label="Custom file pattern" hidden />
            <div class="description">Choose one VS Code glob. Selecting all SQL files changes their language association; existing associations are preserved.</div>
        </div>

        <div class="form-group">
            <label for="schemaRefreshInterval">Automatic schema refresh</label>
            <select id="schemaRefreshInterval">
                <option value="1">Every minute</option>
                <option value="5">Every 5 minutes</option>
                <option value="30">Every 30 minutes</option>
                <option value="60">Every hour</option>
                <option value="0">Never</option>
            </select>
            <div class="description">The initial and manual schema refreshes are always available.</div>
        </div>

        <div class="form-group">
            <label>Semantic token colors</label>
            <div class="description">Leave blank to use the theme color. Changes apply to SingleStore tokens in all themes.</div>
            ${SEMANTIC_TOKEN_TYPES.map(type => `
            <div class="semantic-color-row">
                <label for="semantic-${type}">${type.replace(/_/g, " ")}</label>
                <input type="text" id="semantic-${type}" placeholder="Theme default" aria-label="${type} color" />
                <input type="color" id="semantic-picker-${type}" value="#808080" aria-label="Choose ${type} color" />
            </div>`).join("")}
        </div>

        <div class="actions">
            <button type="submit">Save</button>
            <button type="button" class="secondary" id="resetBtn">Reset</button>
        </div>
    </form>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        const filePatternChoice = document.getElementById('filePatternChoice');
        const customFilePattern = document.getElementById('customFilePattern');
        const schemaRefreshInterval = document.getElementById('schemaRefreshInterval');
        const semanticTypes = ${JSON.stringify(SEMANTIC_TOKEN_TYPES)};
        let originalColors = {};
        const form = document.getElementById('configForm');
        const resetBtn = document.getElementById('resetBtn');

        // Load current configuration on start
        vscode.postMessage({ command: 'loadConfig' });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'semanticColorsSaved') {
                originalColors = message.colors;
                return;
            }
            if (message.command === 'configLoaded') {
                const data = message.data;
                const pattern = data.filePattern || '*.s2db.sql';
                filePatternChoice.value = pattern === '*.s2db.sql' || pattern === '*.sql' ? pattern : 'custom';
                customFilePattern.value = filePatternChoice.value === 'custom' ? pattern : '';
                customFilePattern.hidden = filePatternChoice.value !== 'custom';
                schemaRefreshInterval.value = String(data.schemaRefreshInterval);
                originalColors = data.semanticColors || {};
                for (const type of semanticTypes) {
                    const input = document.getElementById('semantic-' + type);
                    const picker = document.getElementById('semantic-picker-' + type);
                    input.value = originalColors[type] || '';
                    const color = input.value;
                    if (/^#[0-9a-f]{6}$/i.test(color)) picker.value = color;
                    else if (/^#[0-9a-f]{3}$/i.test(color)) picker.value = '#' + [...color.slice(1)].map(c => c + c).join('');
                }
            }
        });

        for (const type of semanticTypes) {
            const input = document.getElementById('semantic-' + type);
            const picker = document.getElementById('semantic-picker-' + type);
            picker.addEventListener('input', () => { input.value = picker.value; });
            input.addEventListener('input', () => {
                if (/^#[0-9a-f]{6}$/i.test(input.value)) picker.value = input.value;
            });
        }

        filePatternChoice.addEventListener('change', () => {
            customFilePattern.hidden = filePatternChoice.value !== 'custom';
        });

        const validationMsg = document.getElementById('validationMsg');

        function validate() {
            return filePatternChoice.value === 'custom' && !customFilePattern.value.trim()
                ? ['Custom file pattern'] : [];
        }

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const missing = validate();
            if (missing.length > 0) {
                validationMsg.textContent = 'Required fields missing: ' + missing.join(', ');
                validationMsg.style.display = 'block';
                return;
            }
            const filePattern = filePatternChoice.value === 'custom'
                ? customFilePattern.value.trim() : filePatternChoice.value;
            if (filePattern.includes('\\\\')) {
                validationMsg.textContent = 'Use / instead of \\\\ in file patterns.';
                validationMsg.style.display = 'block';
                return;
            }
            if (!['0', '1', '5', '30', '60'].includes(schemaRefreshInterval.value)) {
                validationMsg.textContent = 'Choose a valid schema refresh interval.';
                validationMsg.style.display = 'block';
                return;
            }
            const semanticColors = {};
            for (const type of semanticTypes) {
                const color = document.getElementById('semantic-' + type).value.trim();
                if (color === (originalColors[type] || '')) continue;
                if (color && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
                    validationMsg.textContent = 'Invalid color for ' + type + ': use #RGB or #RRGGBB.';
                    validationMsg.style.display = 'block';
                    return;
                }
                semanticColors[type] = color;
            }
            validationMsg.style.display = 'none';
            vscode.postMessage({
                command: 'saveConfig',
                data: {
                    filePattern,
                    schemaRefreshInterval: Number(schemaRefreshInterval.value),
                    semanticColors,
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
