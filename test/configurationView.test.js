const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const vm = require("node:vm");

test("configuration panel saves preset and custom globs and rejects invalid input", async () => {
    let receiveMessage;
    const saved = {};
    const vscode = {
        Uri: { joinPath: () => "logo" },
        ViewColumn: { One: 1 },
        ConfigurationTarget: { Global: 1 },
        workspace: {
            getConfiguration: () => ({
                get: (key, fallback) => saved[key] ?? fallback,
                async update(key, value) { saved[key] = value; },
            }),
        },
        window: {
            showInformationMessage() {},
            showErrorMessage: message => assert.fail(message),
            createWebviewPanel() { return panel; },
        },
    };
    const panel = {
        onDidDispose() {},
        webview: {
            cspSource: "vscode",
            asWebviewUri: () => "logo",
            onDidReceiveMessage(handler) { receiveMessage = handler; },
            postMessage(message) { messages.push(message); },
        },
    };
    const messages = [];
    const load = Module._load;
    Module._load = function (id, ...args) {
        return id === "vscode" ? vscode : load.call(this, id, ...args);
    };
    let ConnectionConfigPanel;
    try {
        ({ ConnectionConfigPanel } = require("../out/configurationView"));
    } finally {
        Module._load = load;
    }
    ConnectionConfigPanel.createOrShow("extension");
    const script = panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
    const listeners = {};
    const elements = {};
    for (const id of ["host", "port", "username", "password", "databaseName", "useSSL",
        "filePatternChoice", "customFilePattern", "configForm", "resetBtn", "validationMsg"]) {
        elements[id] = {
            value: "", checked: false, hidden: false, style: {},
            addEventListener(event, callback) { listeners[`${id}:${event}`] = callback; },
        };
    }
    vm.runInNewContext(script, {
        acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) }),
        document: { getElementById: id => elements[id] },
        window: { addEventListener: (event, callback) => { listeners[`window:${event}`] = callback; } },
    });
    assert.equal(messages.pop().command, "loadConfig");
    await receiveMessage({ command: "loadConfig" });
    listeners["window:message"]({ data: messages.pop() });
    assert.equal(elements.filePatternChoice.value, "*.s2db.sql");
    assert.equal(elements.customFilePattern.hidden, true);

    elements.host.value = "localhost";
    elements.filePatternChoice.value = "*.sql";
    listeners["configForm:submit"]({ preventDefault() {} });
    let message = messages.pop();
    assert.equal(message.data.filePattern, "*.sql");
    await receiveMessage(message);
    assert.equal(saved.filePattern, "*.sql");

    elements.filePatternChoice.value = "custom";
    listeners["filePatternChoice:change"]();
    assert.equal(elements.customFilePattern.hidden, false);
    elements.customFilePattern.value = "**/queries/*.sql";
    listeners["configForm:submit"]({ preventDefault() {} });
    message = messages.pop();
    assert.equal(message.data.filePattern, "**/queries/*.sql");
    await receiveMessage(message);
    assert.equal(saved.filePattern, "**/queries/*.sql");

    elements.customFilePattern.value = "bad\\*.sql";
    listeners["configForm:submit"]({ preventDefault() {} });
    assert.match(elements.validationMsg.textContent, /instead/);
    assert.equal(messages.length, 0);
});
