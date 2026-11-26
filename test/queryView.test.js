const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("runs selections sequentially, records failures, reruns on the active profile and escapes results", async () => {
    const executed = [];
    const panels = [];
    const errors = [];
    let sessions = 0;
    let active = { id: "a", name: "<first>" };
    let editorText = "SELECT 1; BAD; SELECT 3;";
    let start = 0;
    let end = editorText.length;
    const vscode = {
        TreeItem: class { constructor(label) { this.label = label; } },
        TreeItemCollapsibleState: { None: 0 },
        ThemeIcon: class {},
        EventEmitter: class { event() {} fire() {} dispose() {} },
        ViewColumn: { Beside: 2 },
        workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
        window: {
            get activeTextEditor() {
                return {
                    document: { getText: () => editorText, offsetAt: position => position },
                    selection: { start, end, active: end },
                };
            },
            showErrorMessage: message => errors.push(message),
            showInformationMessage() {},
            createWebviewPanel() {
                const panel = { webview: { html: "" }, onDidDispose() {} };
                panels.push(panel);
                return panel;
            },
        },
    };
    const store = {
        getActiveProfile: () => active,
        getActiveProfileId: () => active?.id,
        getDatabaseConfig: async id => ({ id }),
    };
    const load = Module._load;
    Module._load = function (id, ...args) {
        if (id === "vscode") return vscode;
        if (id === "./queryExecution") return {
            QuerySession: class {
                constructor(config) { this.id = config.id; sessions++; }
                async connect() {}
                async execute(sql) {
                    executed.push([this.id, sql]);
                    if (sql === "BAD") throw new Error("<bad>");
                    if (sql === "WAIT") return new Promise((_resolve, reject) => { this.reject = reject; });
                    return [{ columns: ["<script>"], rows: [["<img>"]], totalRows: 1 }];
                }
                dispose() { this.reject?.(new Error("connection closed")); }
            },
        };
        return load.call(this, id, ...args);
    };
    let QueryView;
    try { ({ QueryView } = require("../out/queryView")); } finally { Module._load = load; }
    const view = new QueryView(store);
    await view.runEditor("selection");
    assert.deepEqual(executed, [["a", "SELECT 1"], ["a", "BAD"]]);
    assert.equal(view.getChildren().length, 2);
    assert.match(errors[0], /<bad>/);
    assert.match(panels[0].webview.html, /&lt;script&gt;/);
    assert.match(panels[0].webview.html, /&lt;img&gt;/);
    assert.doesNotMatch(panels[0].webview.html, /<img>/);
    assert.match(panels[0].webview.html, /&lt;bad&gt;/);

    active = { id: "b", name: "second" };
    view.invalidateConnection();
    await view.rerun(view.getChildren()[1]);
    assert.deepEqual(executed[2], ["b", "SELECT 1"]);
    editorText = "SELECT 4; SELECT 5;";
    start = end = editorText.indexOf("5");
    await view.runEditor("auto");
    assert.deepEqual(executed[3], ["b", "SELECT 5"]);
    assert.equal(sessions, 2, "subsequent executions reuse the active SQL session");
    editorText = "WAIT; SELECT 6;";
    start = 0;
    end = editorText.length;
    const pending = view.runEditor("selection");
    view.invalidateConnection();
    await pending;
    assert.deepEqual(executed.at(-1), ["b", "WAIT"]);
    assert.match(errors.at(-1), /connection closed/);
    active = undefined;
    await view.runEditor("cursor");
    assert.match(errors.at(-1), /Connect/);
    assert.equal(view.getChildren().length, 5);
    view.clearHistory();
    assert.equal(view.getChildren().length, 0);
    view.dispose();
});
