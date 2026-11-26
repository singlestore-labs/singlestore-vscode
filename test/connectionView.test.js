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
        TreeItemCollapsibleState: { None: 0 },
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
    assert.match(items[0].description, /dev\.example:3306\/app/);

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
