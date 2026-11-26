const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("connection view exposes connect and disconnect actions for the active profile", () => {
    class TreeItem {
        constructor(label, collapsibleState) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    }
    class EventEmitter {
        constructor() { this.event = () => {}; }
        fire() {}
        dispose() {}
    }
    const vscode = {
        TreeItem,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
        ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
        ThemeColor: class { constructor(id) { this.id = id; } },
        EventEmitter,
    };
    const load = Module._load;
    Module._load = function (id, ...args) {
        return id === "vscode" ? vscode : load.call(this, id, ...args);
    };
    delete require.cache[require.resolve("../out/connectionView")];
    let view;
    try {
        view = require("../out/connectionView");
    } finally {
        Module._load = load;
    }
    const profiles = [
        { id: "dev", name: "Development", host: "dev.example", port: 3306, username: "user", databaseName: "app" },
        { id: "prod", name: "Production", host: "prod.example", port: 3306, username: "user", databaseName: "" },
    ];
    let activeId = "dev";
    const provider = new view.ConnectionTreeProvider({
        getProfiles: () => profiles,
        getActiveProfileId: () => activeId,
    });

    let items = provider.getChildren();
    assert.equal(items.length, 2);
    assert.equal(items[0].command.command, "singlestore.disconnect");
    assert.equal(items[1].command.command, "singlestore.connect");
    assert.equal(items[0].contextValue, "singlestoreConnectionActive");
    assert.equal(items[1].contextValue, "singlestoreConnection");
    assert.equal(items[0].iconPath.id, "plug");
    assert.equal(items[0].iconPath.color.id, "charts.green");
    assert.equal(items[1].iconPath.id, "debug-disconnect");
    assert.equal(items[1].iconPath.color.id, "charts.red");
    assert.equal(items[0].collapsibleState, 1);
    assert.equal(items[1].collapsibleState, 0);
    assert.match(items[0].description, /dev\.example:3306\/app/);

    const activeItem = items[0];
    provider.setSchema({
        objects: [{
            name: "Databases", kind: "category", children: [{
                name: "app", kind: "database", children: [{
                    name: "Tables", kind: "category", children: [{
                        name: "accounts", kind: "table", children: [{
                            name: "Columns", kind: "category", children: [
                                { name: "id", kind: "column", detail: "bigint" },
                            ],
                        }],
                    }],
                }],
            }],
        }],
        refreshedAt: "2026-11-26T12:00:00Z",
    });
    let children = provider.getChildren(activeItem);
    assert.equal(children[0].label, "Databases");
    assert.equal(children[0].command, undefined);
    for (const label of ["app", "Tables", "accounts", "Columns", "id"]) {
        children = provider.getChildren(children[0]);
        assert.equal(children[0].label, label);
    }
    assert.equal(children[0].description, "bigint");
    assert.equal(children[0].contextValue, "singlestoreSchemaObject");
    assert.deepEqual(provider.getChildren(items[1]), []);
    provider.setSchema(undefined);
    assert.match(provider.getChildren(activeItem)[0].label, /Schema not loaded/);

    activeId = "prod";
    provider.refresh();
    items = provider.getChildren();
    assert.equal(items[0].command.command, "singlestore.connect");
    assert.equal(items[1].command.command, "singlestore.disconnect");
    assert.equal(items[0].iconPath.id, "debug-disconnect");
    assert.equal(items[0].iconPath.color.id, "charts.red");
    assert.equal(items[1].iconPath.id, "plug");
    assert.equal(items[1].iconPath.color.id, "charts.green");
    provider.dispose();
});
