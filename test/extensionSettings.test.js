const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("refresh interval changes reschedule without restarting the server", () => {
    let onChange;
    let reschedules = 0;
    let restarts = 0;
    const disposable = { dispose() {} };
    const vscode = {
        StatusBarAlignment: { Left: 1 },
        ThemeColor: class {},
        workspace: {
            onDidChangeConfiguration(callback) { onChange = callback; return disposable; },
            onDidChangeWorkspaceFolders: () => disposable,
        },
        window: {
            createStatusBarItem: () => ({ ...disposable, show() {} }),
            showWarningMessage: async () => undefined,
        },
        commands: { registerCommand: () => disposable },
    };
    const load = Module._load;
    Module._load = function (id, ...args) {
        if (id === "vscode") return vscode;
        if (id === "./configurationView") return { isConfigurationComplete: () => false };
        if (id === "./fileAssociation") return {
            FileAssociationManager: class { update() {} dispose() {} },
        };
        if (id === "./languageClient") return {
            startLanguageClient() {},
            updateSchemaRefreshInterval() { reschedules++; },
            updateDatabaseConfig() { restarts++; },
        };
        return load.call(this, id, ...args);
    };
    let extension;
    try {
        extension = require("../out/extension");
    } finally {
        Module._load = load;
    }
    extension.activate({ subscriptions: [], globalState: {}, extensionUri: {} });
    onChange({ affectsConfiguration: key => key === "singlestore.schemaRefreshInterval" });
    assert.equal(reschedules, 1);
    assert.equal(restarts, 0);
    onChange({ affectsConfiguration: key => key === "singlestore.port" });
    assert.equal(restarts, 1);
});
