const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("editor adapter maps WASM completions and discards stale or cancelled results",
    { timeout: 30000 }, async t => {
        let provider;
        let disposed = 0;
        const errors = [];
        const vscode = {
            workspace: {
                getConfiguration: () => ({ get: (_key, fallback) => fallback }),
                onDidCloseTextDocument: () => ({ dispose() { disposed++; } }),
            },
            languages: {
                registerCompletionItemProvider(_selector, value) {
                    provider = value;
                    return { dispose() { disposed++; } };
                },
            },
            window: {
                setStatusBarMessage() {},
                showErrorMessage: message => errors.push(message),
            },
            CompletionItem: class {
                constructor(label, kind) { this.label = label; this.kind = kind; }
            },
            CompletionList: class {
                constructor(items, isIncomplete) { this.items = items; this.isIncomplete = isIncomplete; }
            },
        };
        const load = Module._load;
        Module._load = function (id, ...args) {
            return id === "vscode" ? vscode : load.call(this, id, ...args);
        };
        let client;
        try {
            client = require("../out/languageClient");
        } finally {
            Module._load = load;
        }
        t.after(() => client.stopLanguageClient());
        await client.startLanguageClient();
        const document = {
            uri: { toString: () => "file:///editor.s2db.sql" },
            getText: () => "SEL",
            version: 1,
        };
        const position = { line: 0, character: 3 };
        const token = { isCancellationRequested: false };
        const result = await provider.provideCompletionItems(document, position, token);
        const select = result.items.find(item => item.label === "SELECT");
        assert.equal(select.kind, 13);
        assert.equal(select.insertText, "SELECT");
        assert.equal(select.filterText, undefined);
        assert.equal(select.commitCharacters, undefined);

        const stale = provider.provideCompletionItems(document, position, token);
        document.version++;
        assert.equal(await stale, undefined);
        assert.equal(await provider.provideCompletionItems(document, position, {
            isCancellationRequested: true,
        }), undefined);
        assert.deepEqual(errors, []);
        client.updateDatabaseConfig();
        await client.stopLanguageClient();
        assert.equal(disposed, 2);
    });
