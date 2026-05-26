import * as vscode from "vscode";
import { ConnectionConfigPanel, isConfigurationComplete } from "./configurationView";
import { startLanguageClient, stopLanguageClient, scheduleRestart, updateDatabaseConfig } from "./languageClient";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
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

    // Watch for external configuration changes (e.g. via Settings UI)
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("singlestore")) {
                updateStatusBar();
                // Restart the language client when configuration changes
                updateDatabaseConfig();
            }
        })
    );

    updateStatusBar();

    // If configured, start the language client; otherwise prompt the user
    if (isConfigurationComplete()) {
        startLanguageClient();
    } else {
        promptForConfiguration(context);
    }
}

function updateStatusBar() {
    if (isConfigurationComplete()) {
        const config = vscode.workspace.getConfiguration("singlestore");
        const host = config.get<string>("host", "");
        const port = config.get<number>("port", 3306);
        statusBarItem.text = "$(database) SingleStore: " + host + ":" + port;
        statusBarItem.tooltip = "SingleStore — Connected configuration. Click to edit.";
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
        "SingleStore connection is not configured. Please provide your connection credentials before using the extension.",
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
