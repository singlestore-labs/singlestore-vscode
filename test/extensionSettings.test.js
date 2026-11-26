const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("settings changes refresh preferences without treating connection values as settings", async () => {
    let onChange;
    let reschedules = 0;
    let restarts = 0;
    let patternUpdates = 0;
    let activeId;
    const profile = { id: "dev", name: "Development", host: "localhost", port: 3306 };
    const commands = {};
    const disposable = { dispose() {} };
    const statusBar = { ...disposable, show() {} };
    const config = {
        get: (_key, fallback) => fallback,
        inspect: () => undefined,
        async update() {},
    };
    const vscode = {
        StatusBarAlignment: { Left: 1 },
        ConfigurationTarget: { Global: 1 },
        ThemeColor: class { constructor(id) { this.id = id; } },
        workspace: {
            getConfiguration: () => config,
            onDidChangeConfiguration(callback) { onChange = callback; return disposable; },
            onDidChangeWorkspaceFolders: () => disposable,
        },
        window: {
            createStatusBarItem: () => statusBar,
            createTreeView: () => disposable,
            showErrorMessage: message => assert.fail(message),
            setStatusBarMessage() {},
        },
        commands: {
            registerCommand(name, callback) { commands[name] = callback; return disposable; },
            executeCommand: () => Promise.resolve(),
        },
    };
    const load = Module._load;
    Module._load = function (id, ...args) {
        if (id === "vscode") return vscode;
        if (id === "./configurationView") return { ConnectionConfigPanel: { createOrShow() {} } };
        if (id === "./connectionStore") return {
            ConnectionStore: class {
                getActiveProfile() { return activeId === profile.id ? profile : undefined; }
                getActiveProfileId() { return activeId; }
                getProfiles() { return [profile]; }
                async getDatabaseConfig() { return {}; }
                async migrateLegacySettings() {}
                async setActiveProfile(id) { activeId = id; }
            },
        };
        if (id === "./connectionView") return {
            ConnectionTreeProvider: class { refresh() {} dispose() {} },
        };
        if (id === "./fileAssociation") return {
            FileAssociationManager: class {
                update() {}
                dispose() {}
            },
        };
        if (id === "./languageClient") return {
            startLanguageClient() {},
            stopLanguageClient() {},
            setDatabaseConfig() {},
            updateFilePattern() { patternUpdates++; },
            updateSchemaRefreshInterval() { reschedules++; },
            updateDatabaseConfig() { restarts++; },
            refreshSchema() {},
        };
        return load.call(this, id, ...args);
    };
    let extension;
    try {
        extension = require("../out/extension");
    } finally {
        Module._load = load;
    }
    extension.activate({
        subscriptions: [],
        globalState: { get: (_key, fallback) => fallback, async update() {} },
        secrets: {},
        extensionUri: {},
    });
    await new Promise(resolve => setImmediate(resolve));
    onChange({ affectsConfiguration: key => key === "singlestore.schemaRefreshInterval" });
    assert.equal(reschedules, 1);
    assert.equal(restarts, 0);
    onChange({ affectsConfiguration: key => key === "singlestore.filePattern" });
    assert.equal(patternUpdates, 1);
    onChange({ affectsConfiguration: key => key === "singlestore.port" });
    assert.equal(restarts, 0);
    assert.match(statusBar.text, /^\$\(debug-disconnect\).*Disconnected/);
    assert.equal(statusBar.color.id, "charts.red");
    await commands["singlestore.connect"]({ profileId: "dev" });
    assert.match(statusBar.text, /^\$\(plug\).*Development/);
    assert.equal(statusBar.color.id, "charts.green");
    await commands["singlestore.disconnect"]();
    assert.match(statusBar.text, /^\$\(debug-disconnect\).*Disconnected/);
    assert.equal(statusBar.color.id, "charts.red");
});
