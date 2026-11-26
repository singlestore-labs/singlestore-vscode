import * as vscode from "vscode";
import { ConnectionConfigPanel } from "./configurationView";
import { ConnectionProfile, ConnectionStore } from "./connectionStore";
import { ConnectionProfilePanel } from "./connectionProfilePanel";
import { ConnectionTreeItem, ConnectionTreeProvider } from "./connectionView";
import { startLanguageClient, stopLanguageClient, setDatabaseConfig, updateDatabaseConfig, refreshSchema, updateFilePattern, updateSchemaRefreshInterval, onSchemaChanged } from "./languageClient";
import { FileAssociationManager } from "./fileAssociation";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    const store = new ConnectionStore(context);
    const provider = new ConnectionTreeProvider(store);
    context.subscriptions.push(provider);
    context.subscriptions.push(onSchemaChanged(catalog => provider.setSchema(catalog)));
    const tree = vscode.window.createTreeView("singlestore.connections", {
        treeDataProvider: provider,
        showCollapseAll: false,
    });
    context.subscriptions.push(tree);

    const associations = new FileAssociationManager(context.globalState);
    context.subscriptions.push(associations);
    void associations.update();

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = "singlestore.focusConnections";
    context.subscriptions.push(statusBarItem);

    const register = (name: string, callback: (...args: never[]) => unknown) => {
        context.subscriptions.push(vscode.commands.registerCommand(name, callback));
    };

    register("singlestore.focusConnections", () =>
        vscode.commands.executeCommand("workbench.view.extension.singlestore"));
    register("singlestore.openConnectionConfig", () => {
        ConnectionConfigPanel.createOrShow(context.extensionUri);
    });
    register("singlestore.refreshSchema", refreshSchema);
    register("singlestore.addConnection", async () => {
        ConnectionProfilePanel.createOrShow(undefined, async data => {
            await store.saveProfile({
                name: data.name,
                host: data.host,
                port: data.port,
                username: data.username,
                databaseName: data.databaseName,
                useSSL: data.useSSL,
            }, data.password);
            provider.refresh();
        });
    });
    register("singlestore.editConnection", async (item?: ConnectionTreeItem) => {
        try {
            const profile = await resolveProfile(store, item);
            if (!profile) return;
            ConnectionProfilePanel.createOrShow(profile, async data => {
                await store.saveProfile({
                    name: data.name,
                    host: data.host,
                    port: data.port,
                    username: data.username,
                    databaseName: data.databaseName,
                    useSSL: data.useSSL,
                }, data.password, profile.id);
                if (data.clearPassword) {
                    await store.clearPassword(profile.id);
                }
                if (store.getActiveProfileId() === profile.id) {
                    setDatabaseConfig(await store.getDatabaseConfig(profile.id));
                    updateDatabaseConfig();
                    updateStatusBar(store);
                }
                provider.refresh();
            });
        } catch (error) {
            showError("Could not open connection editor", error);
        }
    });
    register("singlestore.deleteConnection", async (item?: ConnectionTreeItem) => {
        try {
            const profile = await resolveProfile(store, item);
            if (!profile) return;
            const confirm = await vscode.window.showWarningMessage(
                `Delete the SingleStore connection "${profile.name}"?`,
                { modal: true },
                "Delete"
            );
            if (confirm !== "Delete") return;
            const wasActive = store.getActiveProfileId() === profile.id;
            await store.deleteProfile(profile.id);
            if (wasActive) {
                setDatabaseConfig(undefined);
                updateDatabaseConfig();
            }
            provider.refresh();
            updateStatusBar(store);
        } catch (error) {
            showError("Could not delete connection", error);
        }
    });
    register("singlestore.connect", async (item?: ConnectionTreeItem) => {
        try {
            const profile = await resolveProfile(store, item);
            if (!profile) return;
            setDatabaseConfig(await store.getDatabaseConfig(profile.id));
            await store.setActiveProfile(profile.id);
            updateDatabaseConfig();
            provider.refresh();
            updateStatusBar(store);
            vscode.window.setStatusBarMessage(`SingleStore: Connecting to ${profile.name}`, 3000);
        } catch (error) {
            showError("Could not connect", error);
        }
    });
    register("singlestore.disconnect", async () => {
        try {
            await store.setActiveProfile(undefined);
            setDatabaseConfig(undefined);
            updateDatabaseConfig();
            provider.refresh();
            updateStatusBar(store);
        } catch (error) {
            showError("Could not disconnect", error);
        }
    });

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("singlestore.filePattern")) {
                updateFilePattern();
                void associations.update();
            }
            if (e.affectsConfiguration("files.associations")) {
                void associations.update();
            }
            if (e.affectsConfiguration("singlestore.schemaRefreshInterval")) {
                updateSchemaRefreshInterval();
            }
        })
    );
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void associations.update();
    }));

    updateStatusBar(store);
    void initialize(store, provider);
}

async function initialize(store: ConnectionStore, provider: ConnectionTreeProvider): Promise<void> {
    try {
        await store.migrateLegacySettings();
        const activeId = store.getActiveProfileId();
        if (activeId && store.getProfiles().some(profile => profile.id === activeId)) {
            setDatabaseConfig(await store.getDatabaseConfig(activeId));
        } else {
            await store.setActiveProfile(undefined);
            setDatabaseConfig(undefined);
        }
        provider.refresh();
        updateStatusBar(store);
        await startLanguageClient();
    } catch (error) {
        showError("Could not initialize connections", error);
    }
}

async function resolveProfile(
    store: ConnectionStore,
    item?: ConnectionTreeItem
): Promise<ConnectionProfile | undefined> {
    if (item) {
        return store.getProfiles().find(profile => profile.id === item.profileId);
    }
    const profiles = store.getProfiles();
    if (profiles.length === 0) {
        void vscode.window.showInformationMessage("Add a SingleStore connection first.");
        return;
    }
    const selection = await vscode.window.showQuickPick(
        profiles.map(profile => ({ label: profile.name, description: `${profile.host}:${profile.port}`, profile })),
        { placeHolder: "Select a SingleStore connection", ignoreFocusOut: true }
    );
    return selection?.profile;
}

function updateStatusBar(store: ConnectionStore): void {
    const profile = store.getActiveProfile();
    if (profile) {
        statusBarItem.text = `$(plug) SingleStore: ${profile.name}`;
        statusBarItem.color = new vscode.ThemeColor("charts.green");
        statusBarItem.tooltip = `${profile.host}:${profile.port} — Click to manage connections.`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = "$(debug-disconnect) SingleStore: Disconnected";
        statusBarItem.color = new vscode.ThemeColor("charts.red");
        statusBarItem.tooltip = "No active SingleStore connection. Click to manage connections.";
        statusBarItem.backgroundColor = undefined;
    }
    statusBarItem.show();
}

function showError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`SingleStore: ${message}. ${detail}`);
}

export async function deactivate(): Promise<void> {
    await stopLanguageClient();
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
