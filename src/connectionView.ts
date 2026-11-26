import * as vscode from "vscode";
import { ConnectionProfile, ConnectionStore } from "./connectionStore";
import { SchemaCatalog, SchemaObject } from "./schemaCatalog";

export class ConnectionTreeItem extends vscode.TreeItem {
    constructor(profile: ConnectionProfile, active: boolean) {
        super(profile.name, active ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.profileId = profile.id;
        this.id = profile.id;
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

class SchemaTreeItem extends vscode.TreeItem {
    constructor(readonly object: SchemaObject, readonly objectId: string) {
        super(object.name, object.children?.length
            ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.id = objectId;
        this.description = object.detail;
        this.tooltip = object.detail ? `${object.name}: ${object.detail}` : object.name;
        const icons: Record<string, string> = {
            category: "folder", database: "database", table: "table", view: "preview",
            column: "symbol-field", index: "key", pipeline: "git-merge", link: "link",
            function: "symbol-method", parameter: "symbol-parameter", projection: "layers",
            extension: "extensions", group: "organization", user: "account", role: "shield",
            pool: "dashboard", host: "server", variable: "symbol-variable", text: "symbol-string",
        };
        this.iconPath = new vscode.ThemeIcon(icons[object.kind] ?? "symbol-misc");
        this.contextValue = "singlestoreSchemaObject";
    }
}

type ConnectionViewItem = ConnectionTreeItem | SchemaTreeItem;

export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionViewItem> {
    private readonly changeEmitter = new vscode.EventEmitter<ConnectionViewItem | undefined>();
    readonly onDidChangeTreeData = this.changeEmitter.event;
    private catalog: SchemaCatalog | undefined;

    constructor(private readonly store: ConnectionStore) {}

    getTreeItem(element: ConnectionViewItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConnectionViewItem): ConnectionViewItem[] {
        const activeId = this.store.getActiveProfileId();
        if (element instanceof ConnectionTreeItem) {
            if (element.profileId !== activeId) return [];
            if (!this.catalog) {
                return [new SchemaTreeItem({
                    name: "Schema not loaded — use Refresh Database Schema",
                    kind: "status",
                }, `${activeId}/status`)];
            }
            if (!this.catalog.objects.length) {
                return [new SchemaTreeItem({ name: "No schema objects returned", kind: "status" }, `${activeId}/empty`)];
            }
            return this.schemaItems(this.catalog.objects, activeId);
        }
        if (element) return this.schemaItems(element.object.children ?? [], element.objectId);
        return this.store.getProfiles().map(profile =>
            new ConnectionTreeItem(profile, profile.id === activeId)
        );
    }

    setSchema(catalog: SchemaCatalog | undefined): void {
        this.catalog = catalog;
        this.refresh();
    }

    private schemaItems(objects: SchemaObject[], parentId: string): SchemaTreeItem[] {
        return objects.map(object => new SchemaTreeItem(
            object, `${parentId}/${encodeURIComponent(object.kind)}:${encodeURIComponent(object.name)}`
        ));
    }

    refresh(): void {
        this.changeEmitter.fire(undefined);
    }

    dispose(): void {
        this.changeEmitter.dispose();
    }
}
