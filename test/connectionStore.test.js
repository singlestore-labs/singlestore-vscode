const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function loadConnectionStore(vscode) {
    delete require.cache[require.resolve("../out/connectionStore")];
    const load = Module._load;
    Module._load = function (id, ...args) {
        return id === "vscode" ? vscode : load.call(this, id, ...args);
    };
    try {
        return require("../out/connectionStore").ConnectionStore;
    } finally {
        Module._load = load;
    }
}

function createContext() {
    const values = new Map();
    const secrets = new Map();
    return {
        globalState: {
            get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
            async update(key, value) {
                if (value === undefined) values.delete(key);
                else values.set(key, value);
            },
        },
        secrets: {
            async store(key, value) { secrets.set(key, value); },
            async get(key) { return secrets.get(key); },
            async delete(key) { secrets.delete(key); },
        },
        values,
        secretsMap: secrets,
    };
}

test("connection profiles keep passwords in SecretStorage and enforce a single active profile", async () => {
    const vscode = { workspace: {}, ConfigurationTarget: { Global: 1 } };
    const ConnectionStore = loadConnectionStore(vscode);
    const context = createContext();
    const store = new ConnectionStore(context);
    const profile = await store.saveProfile({
        name: "Development",
        host: "db.example",
        port: 3306,
        username: "developer",
        databaseName: "app",
        useSSL: true,
    }, "secret");

    assert.equal(context.values.get("singlestore.connections")[0].password, undefined);
    assert.equal(context.secretsMap.get(`singlestore.connection.password.${profile.id}`), "secret");
    await store.setActiveProfile(profile.id);
    assert.equal(store.getActiveProfileId(), profile.id);
    assert.deepEqual(await store.getDatabaseConfig(profile.id), {
        host: "db.example",
        port: 3306,
        username: "developer",
        password: "secret",
        database: "app",
        ssl: true,
    });
    await assert.rejects(store.saveProfile({
        name: "development",
        host: "other",
        port: 3306,
        username: "developer",
        databaseName: "",
        useSSL: false,
    }, ""), /already exists/);
    await assert.rejects(store.saveProfile({
        name: "Invalid",
        host: "other",
        port: 70000,
        username: "developer",
        databaseName: "",
        useSSL: false,
    }, ""), /Port/);

    await store.deleteProfile(profile.id);
    assert.equal(store.getActiveProfileId(), undefined);
    assert.equal(context.secretsMap.has(`singlestore.connection.password.${profile.id}`), false);
    assert.deepEqual(store.getProfiles(), []);
});

test("legacy global connection settings are migrated and removed", async () => {
    const legacy = {
        host: "legacy.example",
        port: 3307,
        username: "legacy-user",
        password: "old-secret",
        databaseName: "legacy-db",
        useSSL: true,
    };
    const vscode = {
        ConfigurationTarget: { Global: 1 },
        workspace: {
            getConfiguration: () => ({
                get: (key, fallback) => legacy[key] ?? fallback,
                inspect: key => ({ globalValue: legacy[key] }),
                async update(key, value, target) {
                    assert.equal(target, 1);
                    if (value === undefined) delete legacy[key];
                    else legacy[key] = value;
                },
            }),
        },
    };
    const ConnectionStore = loadConnectionStore(vscode);
    const context = createContext();
    const store = new ConnectionStore(context);
    await store.migrateLegacySettings();

    assert.equal(store.getProfiles().length, 1);
    assert.equal(store.getProfiles()[0].name, "Migrated connection");
    assert.equal(store.getActiveProfileId(), store.getProfiles()[0].id);
    assert.equal((await store.getDatabaseConfig(store.getActiveProfileId())).password, "old-secret");
    assert.deepEqual(legacy, {});
    await store.migrateLegacySettings();
    assert.equal(store.getProfiles().length, 1);
});
