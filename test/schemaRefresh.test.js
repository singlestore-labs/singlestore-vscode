const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

test("configured server refreshes periodically, avoids overlaps, retries failures, and stops its timer", async t => {
    const timers = [];
    const errors = [];
    const logs = [];
    const servers = [];
    let configuredInterval;
    let intervalMs;
    t.mock.method(global, "setInterval", (callback, ms) => {
        intervalMs = ms;
        const timer = { callback, ms, cleared: false };
        timers.push(timer);
        return timer;
    });
    t.mock.method(global, "clearInterval", timer => { timer.cleared = true; });
    t.mock.method(console, "error", (...args) => logs.push(args));

    class FakeServer {
        constructor() { this.refreshes = []; servers.push(this); }
        request(method) {
            if (method === "initialize") return Promise.resolve({ tokenTypes: ["unknown", "identifier", "string", "number", "operator", "keyword", "end_of_query", "comment"], tokenModifiers: [] });
            if (method === "refreshSchema") {
                const refresh = deferred();
                this.refreshes.push(refresh);
                return refresh.promise;
            }
            throw new Error(`Unexpected request: ${method}`);
        }
        async stop() { this.stopped = true; }
    }
    const vscode = {
        ProgressLocation: { Window: 1 },
        workspace: {
            getConfiguration: () => ({
                get: (key, fallback) => key === "schemaRefreshInterval" && configuredInterval !== undefined
                    ? configuredInterval : fallback,
            }),
            onDidCloseTextDocument: () => ({ dispose() {} }),
        },
        languages: {
            registerCompletionItemProvider: () => ({ dispose() {} }),
            registerDocumentSemanticTokensProvider: () => ({ dispose() {} }),
        },
        SemanticTokensLegend: class {},
        window: {
            withProgress: (_options, task) => task(),
            showErrorMessage: message => errors.push(message),
            setStatusBarMessage() {},
        },
    };
    const load = Module._load;
    Module._load = function (id, ...args) {
        if (id === "vscode") return vscode;
        if (id === "./wasmServer") return { WasmServer: FakeServer };
        if (id === "./configurationView") return { isConfigurationComplete: () => true };
        return load.call(this, id, ...args);
    };
    let client;
    try {
        client = require("../out/languageClient");
    } finally {
        Module._load = load;
    }
    t.after(() => client.stopLanguageClient());
    const flush = () => new Promise(resolve => setImmediate(resolve));

    await client.startLanguageClient();
    assert.equal(intervalMs, 300000);
    assert.equal(servers[0].refreshes.length, 1);
    timers[0].callback();
    assert.equal(servers[0].refreshes.length, 1);
    const manual = client.refreshSchema();
    assert.equal(servers[0].refreshes.length, 1);
    servers[0].refreshes[0].resolve();
    await manual;

    timers[0].callback();
    assert.equal(servers[0].refreshes.length, 2);
    const manualDuringAutomatic = client.refreshSchema();
    timers[0].callback();
    assert.equal(servers[0].refreshes.length, 2);
    servers[0].refreshes[1].reject(new Error("offline"));
    await manualDuringAutomatic;
    await flush();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /offline/);
    const errorCount = errors.length;
    timers[0].callback();
    servers[0].refreshes[2].reject(new Error("still offline"));
    await flush();
    assert.equal(errors.length, errorCount);
    assert.equal(logs.length, 2);
    timers[0].callback();
    servers[0].refreshes[3].resolve();
    await flush();
    timers[0].callback();
    servers[0].refreshes[4].reject(new Error("offline again"));
    await flush();
    assert.equal(errors.length, errorCount + 1);

    let lastTimer = timers[0];
    for (const [minutes, milliseconds] of [[1, 60000], [30, 1800000], [60, 3600000], [5, 300000]]) {
        configuredInterval = minutes;
        client.updateSchemaRefreshInterval();
        assert.equal(lastTimer.cleared, true);
        lastTimer = timers.at(-1);
        assert.equal(lastTimer.ms, milliseconds);
        assert.equal(servers.length, 1);
    }
    configuredInterval = 0;
    client.updateSchemaRefreshInterval();
    assert.equal(lastTimer.cleared, true);
    const timerCount = timers.length;
    lastTimer.callback();
    assert.equal(servers[0].refreshes.length, 5);
    const manualWhenDisabled = client.refreshSchema();
    assert.equal(servers[0].refreshes.length, 6);
    servers[0].refreshes[5].resolve();
    await manualWhenDisabled;
    assert.equal(timers.length, timerCount);
    configuredInterval = 2;
    client.updateSchemaRefreshInterval();
    assert.match(errors.at(-1), /Invalid schema refresh interval/);
    assert.equal(timers.length, timerCount);
    configuredInterval = 1;
    client.updateSchemaRefreshInterval();
    assert.equal(timers.at(-1).ms, 60000);
    lastTimer = timers.at(-1);

    client.updateDatabaseConfig();
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(lastTimer.cleared, true);
    assert.equal(servers[0].stopped, true);
    assert.equal(timers.length, timerCount + 2);
    assert.equal(timers.at(-1).ms, 60000);
    timers[0].callback();
    assert.equal(servers[0].refreshes.length, 6);
    servers[1].refreshes[0].resolve();
    await flush();
    configuredInterval = 0;
    client.updateSchemaRefreshInterval();
    assert.equal(timers.at(-1).cleared, true);
    const countBeforeRestart = timers.length;
    client.updateDatabaseConfig();
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(servers.length, 3);
    assert.equal(servers[2].refreshes.length, 1);
    assert.equal(timers.length, countBeforeRestart);
    servers[2].refreshes[0].resolve();
    await flush();
    await client.stopLanguageClient();
    assert.equal(timers.at(-1).cleared, true);
});

test("offline grammar-only mode does not start periodic refresh", async t => {
    let intervals = 0;
    t.mock.method(global, "setInterval", () => { intervals++; });
    const vscode = {
        workspace: {
            getConfiguration: () => ({ get: (_key, fallback) => fallback }),
            onDidCloseTextDocument: () => ({ dispose() {} }),
        },
        languages: { registerCompletionItemProvider: () => ({ dispose() {} }), registerDocumentSemanticTokensProvider: () => ({ dispose() {} }) },
        SemanticTokensLegend: class {},
        window: { setStatusBarMessage() {}, showErrorMessage() {} },
    };
    class FakeServer {
        async request(method) {
            assert.equal(method, "initialize");
            return { tokenTypes: ["unknown", "identifier", "string", "number", "operator", "keyword", "end_of_query", "comment"], tokenModifiers: [] };
        }
        async stop() {}
    }
    const load = Module._load;
    Module._load = function (id, ...args) {
        if (id === "vscode") return vscode;
        if (id === "./wasmServer") return { WasmServer: FakeServer };
        if (id === "./configurationView") return { isConfigurationComplete: () => false };
        return load.call(this, id, ...args);
    };
    let client;
    try {
        delete require.cache[require.resolve("../out/languageClient")];
        client = require("../out/languageClient");
    } finally {
        Module._load = load;
    }
    await client.startLanguageClient();
    assert.equal(intervals, 0);
    await client.stopLanguageClient();
});
