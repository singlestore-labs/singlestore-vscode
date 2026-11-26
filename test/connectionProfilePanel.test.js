const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const vm = require("node:vm");

test("connection editor displays all fields and submits the complete profile in one form", async () => {
    let receiveMessage;
    let disposed = false;
    let onSave = async () => {};
    const messages = [];
    const panel = {
        title: "",
        webview: {
            html: "",
            onDidReceiveMessage(handler) { receiveMessage = handler; },
            async postMessage(message) { messages.push(message); },
        },
        onDidDispose(handler) { this.disposeHandler = handler; },
        reveal() {},
        dispose() {
            disposed = true;
            this.disposeHandler();
        },
    };
    const vscode = {
        ViewColumn: { One: 1 },
        window: {
            activeTextEditor: undefined,
            createWebviewPanel(_type, _title, _column, options) {
                assert.equal(options.enableScripts, true);
                return panel;
            },
        },
    };
    const load = Module._load;
    Module._load = function (id, ...args) {
        return id === "vscode" ? vscode : load.call(this, id, ...args);
    };
    delete require.cache[require.resolve("../out/connectionProfilePanel")];
    let ConnectionProfilePanel;
    try {
        ({ ConnectionProfilePanel } = require("../out/connectionProfilePanel"));
    } finally {
        Module._load = load;
    }
    const profile = {
        id: "dev-id",
        name: "Development",
        host: "db.example",
        port: 3307,
        username: "developer",
        databaseName: "app",
        useSSL: true,
    };
    ConnectionProfilePanel.createOrShow(profile, callback => onSave(callback));

    for (const id of ["name", "host", "port", "username", "password", "databaseName", "useSSL", "clearPassword"]) {
        assert.match(panel.webview.html, new RegExp(`id="${id}"`));
    }
    assert.match(panel.webview.html, /Leave blank to keep the current password/);
    assert.doesNotMatch(panel.webview.html, /dev-id/);
    assert.doesNotMatch(panel.webview.html, /"password"\s*:/);

    const script = panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
    const listeners = {};
    const elements = {};
    for (const id of ["heading", "error", "name", "host", "port", "username", "password",
        "passwordHint", "clearPasswordField", "clearPassword", "databaseName", "useSSL",
        "form", "save", "cancel"]) {
        elements[id] = {
            value: "",
            checked: false,
            hidden: false,
            disabled: false,
            style: {},
            addEventListener(event, callback) { listeners[`${id}:${event}`] = callback; },
        };
    }
    vm.runInNewContext(script, {
        acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) }),
        document: { getElementById: id => elements[id] },
        window: { addEventListener: (event, callback) => { listeners[`window:${event}`] = callback; } },
    });
    assert.equal(elements.heading.textContent, "Edit connection");
    assert.equal(elements.name.value, "Development");
    assert.equal(elements.host.value, "db.example");
    assert.equal(elements.port.value, 3307);
    assert.equal(elements.username.value, "developer");
    assert.equal(elements.databaseName.value, "app");
    assert.equal(elements.useSSL.checked, true);

    let submitted;
    onSave = async data => { submitted = data; };
    elements.password.value = "replacement";
    elements.clearPassword.checked = false;
    listeners["form:submit"]({ preventDefault() {} });
    const request = messages.pop();
    assert.equal(request.command, "save");
    await receiveMessage(request);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(submitted, {
        name: "Development",
        host: "db.example",
        port: 3307,
        username: "developer",
        password: "replacement",
        databaseName: "app",
        useSSL: true,
        clearPassword: false,
    });
    assert.equal(disposed, true);
    assert.deepEqual(messages.pop(), { command: "saved" });
});
