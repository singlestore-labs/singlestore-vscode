import * as vscode from "vscode";
import { ConnectionProfile, ConnectionStore } from "./connectionStore";

export class ConnectionTreeItem extends vscode.TreeItem {
    constructor(profile: ConnectionProfile, active: boolean) {
        super(profile.name, vscode.TreeItemCollapsibleState.None);
        this.profileId = profile.id;
        this.description = `${profile.username}@${profile.host}:${profile.port}${profile.databaseName ? `/${profile.databaseName}` : ""}`;
        this.tooltip = `${profile.name}\n${this.description}`;
        this.contextValue = active ? "singlestoreConnectionActive" : "singlestoreConnection";
        this.iconPath = new vscode.ThemeIcon(
            active ? "plug" : "debug-disconnect",
            new vscode.ThemeColor(active ? "charts.green" : "charts.red")
        );
        this.command = {
            command: active ? "singlestore.disconnect" : "singlestore.connect",
            title: active ? "Disconnect" : "Connect",
            arguments: [this],
        };
    }

    readonly profileId: string;
}

export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
    private readonly changeEmitter = new vscode.EventEmitter<ConnectionTreeItem | undefined>();
    readonly onDidChangeTreeData = this.changeEmitter.event;

    constructor(private readonly store: ConnectionStore) {}

    getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): ConnectionTreeItem[] {
        const activeId = this.store.getActiveProfileId();
        return this.store.getProfiles().map(profile =>
            new ConnectionTreeItem(profile, profile.id === activeId)
        );
    }

    refresh(): void {
        this.changeEmitter.fire(undefined);
    }

    dispose(): void {
        this.changeEmitter.dispose();
    }
}
