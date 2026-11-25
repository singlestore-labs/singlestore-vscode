const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function fixture(initial = {}) {
    let pattern = "*.s2db.sql";
    let global = { ...initial };
    let workspace = {};
    let folder = {};
    const state = new Map();
    const warnings = [];
    const errors = [];
    const updates = [];
    const vscode = {
        ConfigurationTarget: { Global: 1 },
        workspace: {
            workspaceFolders: [{ uri: "folder" }],
            getConfiguration(section, uri) {
                if (section === "singlestore") {
                    return { get: () => pattern };
                }
                return {
                    inspect: () => ({
                        globalValue: global,
                        workspaceValue: workspace,
                        workspaceFolderValue: uri ? folder : undefined,
                    }),
                    async update(_key, value, target) {
                        assert.equal(target, 1);
                        global = { ...value };
                        updates.push(global);
                    },
                };
            },
        },
        window: {
            showWarningMessage: message => warnings.push(message),
            showErrorMessage: message => errors.push(message),
        },
    };
    const load = Module._load;
    Module._load = function (id, ...args) {
        return id === "vscode" ? vscode : load.call(this, id, ...args);
    };
    let FileAssociationManager;
    try {
        delete require.cache[require.resolve("../out/fileAssociation")];
        ({ FileAssociationManager } = require("../out/fileAssociation"));
    } finally {
        Module._load = load;
    }
    const manager = new FileAssociationManager({
        get: key => state.get(key),
        async update(key, value) { state.set(key, value); },
    });
    return {
        manager, warnings, errors, updates,
        setPattern: value => { pattern = value; },
        setGlobal: value => { global = value; },
        setWorkspace: value => { workspace = value; },
        setFolder: value => { folder = value; },
        global: () => global,
    };
}

test("replaces only the extension-owned file association and preserves unrelated entries", async () => {
    const f = fixture({ "*.py": "python" });
    await f.manager.update();
    assert.deepEqual(f.global(), { "*.py": "python", "*.s2db.sql": "singlestore-sql" });
    f.setPattern("*.sql");
    await f.manager.update();
    assert.deepEqual(f.global(), { "*.py": "python", "*.sql": "singlestore-sql" });
    f.setPattern("**/queries/*.sql");
    await f.manager.update();
    assert.deepEqual(f.global(), { "*.py": "python", "**/queries/*.sql": "singlestore-sql" });
    await f.manager.update();
    assert.equal(f.updates.length, 3);
    assert.deepEqual(f.errors, []);
});

test("does not replace conflicting or delete pre-existing associations", async () => {
    const f = fixture({ "*.sql": "other-sql", "*.s2db.sql": "singlestore-sql" });
    await f.manager.update();
    f.setPattern("*.sql");
    await f.manager.update();
    assert.deepEqual(f.global(), { "*.sql": "other-sql", "*.s2db.sql": "singlestore-sql" });
    assert.match(f.warnings[0], /other-sql/);
    await f.manager.update();
    assert.equal(f.warnings.length, 1);
    f.setPattern("*.custom");
    await f.manager.update();
    assert.equal(f.global()["*.sql"], "other-sql");
    assert.equal(f.global()["*.s2db.sql"], "singlestore-sql");
});

test("preserves user changes to owned entries and reports workspace conflicts", async () => {
    const f = fixture();
    await f.manager.update();
    f.setGlobal({ "*.s2db.sql": "other-sql" });
    f.setPattern("*.sql");
    f.setWorkspace({ "*.sql": "workspace-sql" });
    await f.manager.update();
    assert.equal(f.global()["*.s2db.sql"], "other-sql");
    assert.match(f.warnings[0], /workspace-sql/);
    f.setWorkspace({});
    f.setFolder({ "*.sql": "folder-sql" });
    await f.manager.update();
    assert.match(f.warnings[1], /folder-sql/);
});

test("invalid patterns are reported without changing associations", async () => {
    const f = fixture();
    await f.manager.update();
    f.setPattern("   ");
    await f.manager.update();
    f.setPattern("folder\\*.sql");
    await f.manager.update();
    assert.equal(f.errors.length, 2);
    assert.deepEqual(f.global(), { "*.s2db.sql": "singlestore-sql" });
});
