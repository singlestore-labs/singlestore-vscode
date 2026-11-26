const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const vm = require("node:vm");

test("preferences panel saves preset and custom globs and rejects invalid input", async () => {
    let receiveMessage;
    const saved = {};
    let editorSettings = { rules: { "singlestoreKeyword": "#abcdef", variable: "#123456" }, enabled: true };
    const vscode = {
        Uri: { joinPath: () => "logo" },
        ViewColumn: { One: 1 },
        ConfigurationTarget: { Global: 1 },
        workspace: {
            getConfiguration: section => section === "editor" ? {
                inspect: () => ({ globalValue: editorSettings }),
                async update(_key, value) { editorSettings = value; },
            } : ({
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
    for (const id of ["filePatternChoice", "customFilePattern", "schemaRefreshInterval", "queryRowLimit",
        "configForm", "resetBtn", "validationMsg",
        ...["unknown", "identifier", "string", "number", "operator", "keyword", "end_of_query", "comment"]
            .flatMap(type => [`semantic-${type}`, `semantic-picker-${type}`])]) {
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
    assert.equal(elements.schemaRefreshInterval.value, "5");
    assert.equal(elements.queryRowLimit.value, "200");
    assert.equal(elements["semantic-keyword"].value, "#abcdef");

    elements.filePatternChoice.value = "*.sql";
    elements.schemaRefreshInterval.value = "0";
    elements.queryRowLimit.value = "25";
    elements["semantic-picker-string"].value = "#112233";
    listeners["semantic-picker-string:input"]();
    assert.equal(elements["semantic-string"].value, "#112233");
    elements["semantic-keyword"].value = "";
    listeners["configForm:submit"]({ preventDefault() {} });
    let message = messages.pop();
    assert.equal(message.data.filePattern, "*.sql");
    await receiveMessage(message);
    assert.equal(saved.filePattern, "*.sql");
    assert.equal(saved.schemaRefreshInterval, 0);
    assert.equal(saved.queryRowLimit, 25);
    assert.equal(editorSettings.rules.singlestoreString, "#112233");
    assert.equal(editorSettings.rules.singlestoreKeyword, undefined);
    assert.equal(editorSettings.rules.variable, "#123456");
    listeners["window:message"]({ data: messages.pop() });

    elements.filePatternChoice.value = "custom";
    listeners["filePatternChoice:change"]();
    assert.equal(elements.customFilePattern.hidden, false);
    elements.customFilePattern.value = "**/queries/*.sql";
    listeners["configForm:submit"]({ preventDefault() {} });
    message = messages.pop();
    assert.equal(message.data.filePattern, "**/queries/*.sql");
    await receiveMessage(message);
    assert.equal(saved.filePattern, "**/queries/*.sql");
    listeners["window:message"]({ data: messages.pop() });
    await receiveMessage({ command: "loadConfig" });
    listeners["window:message"]({ data: messages.pop() });
    assert.equal(elements.schemaRefreshInterval.value, "0");

    elements.customFilePattern.value = "bad\\*.sql";
    listeners["configForm:submit"]({ preventDefault() {} });
    assert.match(elements.validationMsg.textContent, /instead/);
    assert.equal(messages.length, 0);
    elements.customFilePattern.value = "**/queries/*.sql";
    elements.schemaRefreshInterval.value = "";
    listeners["configForm:submit"]({ preventDefault() {} });
    assert.match(elements.validationMsg.textContent, /refresh interval/);
    assert.equal(messages.length, 0);
    elements.schemaRefreshInterval.value = "5";
    elements.queryRowLimit.value = "0";
    listeners["configForm:submit"]({ preventDefault() {} });
    assert.match(elements.validationMsg.textContent, /positive integer/);
    assert.equal(messages.length, 0);
    elements.queryRowLimit.value = "25";
    elements["semantic-number"].value = "blue";
    listeners["configForm:submit"]({ preventDefault() {} });
    assert.match(elements.validationMsg.textContent, /Invalid color/);
    assert.equal(messages.length, 0);
});
