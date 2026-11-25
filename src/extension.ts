import * as vscode from "vscode";
import { ConnectionConfigPanel, isConfigurationComplete } from "./configurationView";
import { startLanguageClient, stopLanguageClient, updateDatabaseConfig, refreshSchema, updateFilePattern, updateSchemaRefreshInterval } from "./languageClient";
import { FileAssociationManager } from "./fileAssociation";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    const associations = new FileAssociationManager(context.globalState);
    context.subscriptions.push(associations);
    associations.update();
    // Status bar item to show connection status
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBarItem.command = "singlestore.openConnectionConfig";
    context.subscriptions.push(statusBarItem);

    const openConfigCommand = vscode.commands.registerCommand(
        "singlestore.openConnectionConfig",
        () => {
            ConnectionConfigPanel.createOrShow(context.extensionUri, () => {
                updateStatusBar();
            });
        }
    );

    context.subscriptions.push(openConfigCommand);
    context.subscriptions.push(vscode.commands.registerCommand(
        "singlestore.refreshSchema",
        refreshSchema
    ));

    // Watch for external configuration changes (e.g. via Settings UI)
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("singlestore.filePattern")) {
                updateFilePattern();
                associations.update();
            }
            if (e.affectsConfiguration("files.associations")) {
                associations.update();
            }
            if (e.affectsConfiguration("singlestore.schemaRefreshInterval")) {
                updateSchemaRefreshInterval();
            }
            if (["host", "port", "username", "password", "databaseName", "useSSL"]
                .some(key => e.affectsConfiguration(`singlestore.${key}`))) {
                updateStatusBar();
                updateDatabaseConfig();
            }
        })
    );
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void associations.update();
    }));

    updateStatusBar();

    void startLanguageClient();
    if (!isConfigurationComplete()) {
        void promptForConfiguration(context);
    }
}

function updateStatusBar() {
    if (isConfigurationComplete()) {
        const config = vscode.workspace.getConfiguration("singlestore");
        const host = config.get<string>("host", "");
        const port = config.get<number>("port", 3306);
        statusBarItem.text = "$(database) SingleStore: " + host + ":" + port;
        statusBarItem.tooltip = "SingleStore — Database configuration is set. Click to edit.";
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = "$(warning) SingleStore: Not Configured";
        statusBarItem.tooltip =
            "SingleStore connection is not configured. Click to set up.";
        statusBarItem.backgroundColor = new vscode.ThemeColor(
            "statusBarItem.warningBackground"
        );
    }
    statusBarItem.show();
}

async function promptForConfiguration(
    context: vscode.ExtensionContext
): Promise<void> {
    const action = await vscode.window.showWarningMessage(
        "Configure a SingleStore database connection for schema-aware completions. Grammar completions are available offline.",
        "Configure Now"
    );
    if (action === "Configure Now") {
        ConnectionConfigPanel.createOrShow(context.extensionUri, () => {
            updateStatusBar();
        });
    }
}

export async function deactivate(): Promise<void> {
    await stopLanguageClient();
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
