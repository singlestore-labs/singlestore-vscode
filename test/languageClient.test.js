const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("editor adapter maps WASM completions and discards stale or cancelled results",
    { timeout: 30000 }, async t => {
        let provider;
        let selector;
        let semanticProvider;
        let disposed = 0;
        let pattern = "*.s2db.sql";
        const errors = [];
        const vscode = {
            workspace: {
                getConfiguration: () => ({ get: (key, fallback) => key === "filePattern" ? pattern : fallback }),
                onDidCloseTextDocument: () => ({ dispose() { disposed++; } }),
            },
            languages: {
                registerCompletionItemProvider(valueSelector, value) {
                    selector = valueSelector;
                    provider = value;
                    return { dispose() { disposed++; } };
                },
                registerDocumentSemanticTokensProvider(valueSelector, value, legend) {
                    assert.deepEqual(valueSelector, selector);
                    assert.ok(legend.tokenTypes.includes("singlestoreKeyword"));
                    semanticProvider = value;
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
            SemanticTokensLegend: class {
                constructor(tokenTypes, tokenModifiers) { this.tokenTypes = tokenTypes; this.tokenModifiers = tokenModifiers; }
            },
            SemanticTokens: class { constructor(data) { this.data = data; } },
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
        assert.deepEqual(selector.map(item => item.pattern), ["**/*.s2db.sql", "**/*.s2db.sql"]);
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
        const semantic = await semanticProvider.provideDocumentSemanticTokens(document, token);
        assert.ok(semantic.data instanceof Uint32Array);
        assert.ok(semantic.data.length > 0);
        const staleSemantic = semanticProvider.provideDocumentSemanticTokens(document, token);
        document.version++;
        assert.equal(await staleSemantic, undefined);

        const stale = provider.provideCompletionItems(document, position, token);
        document.version++;
        assert.equal(await stale, undefined);
        assert.equal(await provider.provideCompletionItems(document, position, {
            isCancellationRequested: true,
        }), undefined);
        pattern = "*.sql";
        client.updateFilePattern();
        assert.deepEqual(selector.map(item => item.pattern), ["**/*.sql", "**/*.sql"]);
        assert.equal(disposed, 2);
        pattern = "**/queries/*.sql";
        client.updateFilePattern();
        assert.deepEqual(selector.map(item => item.pattern), [pattern, pattern]);
        assert.equal(disposed, 4);
        pattern = "";
        client.updateFilePattern();
        assert.deepEqual(selector.map(item => item.pattern), ["**/queries/*.sql", "**/queries/*.sql"]);
        assert.match(errors.pop(), /file pattern/i);
        assert.deepEqual(errors, []);
        client.updateDatabaseConfig();
        await client.stopLanguageClient();
        assert.equal(disposed, 7);
    });
