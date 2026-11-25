const assert = require("node:assert/strict");
const test = require("node:test");
const driver = require("singlestore-nodejs/promise");
const { SqlExecutor } = require("../out/sqlExecutor");

const config = {
    host: "example.test", port: 3306, username: "reader",
    password: " secret ", database: "primary", ssl: true,
};

test("executor preserves positional values, binds parameters and isolates database pools", async t => {
    const pools = [];
    const queries = [];
    let released = 0;
    t.mock.method(driver, "createPool", options => {
        pools.push(options);
        return {
            async getConnection() {
                return {
                    async query(query) {
                        queries.push(query);
                        return [
                            [[null, "9007199254740993", Buffer.from("metadata"), false], ["second"]],
                            [{ name: "value" }, { name: "value" }, { name: "binary" }, { name: "flag" }],
                        ];
                    },
                    release() { released++; },
                    destroy() { assert.fail("successful queries should reuse their connections"); },
                };
            },
        };
    });
    const executor = new SqlExecutor(config);
    const result = await executor.execute({ sql: "SELECT ?", parameters: ["value"] });
    assert.deepEqual(result, {
        columns: [{ name: "value" }, { name: "value" }, { name: "binary" }, { name: "flag" }],
        rows: [[null, "9007199254740993", "metadata", false], ["second"]],
        rowCount: 2,
    });
    const limited = await executor.execute({ sql: "SELECT ?", parameters: [null], maxRows: 1 });
    assert.equal(limited.rows.length, 1);
    await executor.execute({ sql: "SHOW TABLES", database: "secondary" });
    assert.equal(pools.length, 2);
    assert.equal(pools[0].database, "primary");
    assert.equal(pools[1].database, "secondary");
    assert.equal(pools[0].password, " secret ");
    assert.deepEqual(pools[0].ssl, { rejectUnauthorized: true });
    assert.equal(pools[0].rowsAsArray, true);
    assert.equal(pools[0].multipleStatements, false);
    assert.deepEqual(queries[0].values, ["value"]);
    assert.equal(released, 3);
});

test("executor propagates database failures and destroys failed connections", async t => {
    let destroyed = 0;
    let released = 0;
    t.mock.method(driver, "createPool", () => ({
        async getConnection() {
            return {
                async query() { throw new Error("access denied"); },
                destroy() { destroyed++; },
                release() { released++; },
            };
        },
    }));
    await assert.rejects(new SqlExecutor(config).execute({ sql: "SHOW TABLES" }), /access denied/);
    assert.equal(destroyed, 1);
    assert.equal(released, 1);
});

test("executor aborts SQL and pending connection acquisition without waiting for the driver", async t => {
    for (const phase of ["connect", "query"]) {
        const controller = new AbortController();
        let destroyed = 0;
        let acquired;
        let started;
        const ready = new Promise(resolve => { started = resolve; });
        const connection = {
            query() {
                started();
                return new Promise(() => {});
            },
            destroy() { destroyed++; },
            release() {},
        };
        const mock = t.mock.method(driver, "createPool", () => ({
            getConnection() {
                if (phase === "connect") {
                    started();
                    return new Promise(resolve => { acquired = resolve; });
                }
                return Promise.resolve(connection);
            },
        }));
        const executing = new SqlExecutor(config).execute({ sql: "SELECT 1" }, {
            signal: controller.signal,
        });
        await ready;
        controller.abort();
        await assert.rejects(executing, { name: "AbortError" });
        if (phase === "connect") {
            acquired(connection);
            await new Promise(resolve => setImmediate(resolve));
        }
        assert.ok(destroyed > 0);
        mock.mock.restore();
    }
});
