const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("semantic colors preserve unrelated and theme-specific rules and style attributes", async () => {
    let updates = 0;
    let settings = {
        enabled: true,
        "[Example Theme]": { rules: { singlestoreKeyword: "#ffffff" } },
        rules: {
            singlestoreKeyword: { foreground: "#123456", bold: true },
            singlestoreString: "#aabbcc",
            variable: "#987654",
        },
    };
    const vscode = {
        ConfigurationTarget: { Global: 1 },
        workspace: {
            getConfiguration: () => ({
                inspect: () => ({ globalValue: settings }),
                async update(_key, value, target) {
                    assert.equal(target, 1);
                    settings = value;
                    updates++;
                },
            }),
        },
    };
    const load = Module._load;
    Module._load = function (id, ...args) {
        return id === "vscode" ? vscode : load.call(this, id, ...args);
    };
    let colors;
    try {
        colors = require("../out/semanticColors");
    } finally {
        Module._load = load;
    }
    assert.deepEqual(colors.getSemanticColors(), { keyword: "#123456", string: "#aabbcc" });
    await colors.saveSemanticColors({ keyword: "#abc", string: "", number: "#a1b2c3" });
    assert.deepEqual(settings.rules, {
        singlestoreKeyword: { foreground: "#abc", bold: true },
        singlestoreNumber: "#a1b2c3",
        variable: "#987654",
    });
    assert.equal(settings["[Example Theme]"].rules.singlestoreKeyword, "#ffffff");
    await colors.saveSemanticColors({ keyword: "" });
    assert.deepEqual(settings.rules.singlestoreKeyword, { bold: true });
    await colors.saveSemanticColors({});
    assert.equal(updates, 2);
    await assert.rejects(colors.saveSemanticColors({ keyword: "red" }), /hex color/);
    await assert.rejects(colors.saveSemanticColors({ unexpected: "#abcdef" }), /Unknown semantic token/);
    assert.equal(updates, 2);
});
