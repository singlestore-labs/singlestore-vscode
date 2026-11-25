const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const singlestore = require("singlestore-nodejs");
const { WasmServer } = require("../out/wasmServer");

function complete(server, text, version = 1, uri = "file:///test.s2db.sql") {
    const lines = text.split("\n");
    return server.request("complete", {
        uri, text, version,
        position: { line: lines.length - 1, character: lines.at(-1).length },
    });
}

test("bundled WASM completes, updates UTF-16 documents, closes and stops", { timeout: 30000 }, async t => {
    const server = new WasmServer(undefined, error => assert.fail(error));
    t.after(() => server.stop());
    await server.request("initialize");
    const initial = await complete(server, "SEL");
    assert.ok(initial.completions.some(item => item.label === "SELECT" && item.kind === 14));
    assert.equal(typeof initial.isIncomplete, "boolean");

    const changed = await complete(server, "-- 😀\r\nSEL", 2);
    assert.ok(changed.completions.some(item => item.label === "SELECT"));
    await assert.rejects(complete(server, "SELECT ", 1), /version/i);
    await server.request("close", { uri: "file:///test.s2db.sql" });
    const reopened = await complete(server, "SEL", 1);
    assert.ok(reopened.completions.some(item => item.label === "SELECT"));
    await assert.rejects(server.request("refreshSchema"), /executor/i);
    await server.stop();
    await assert.rejects(complete(server, "SEL"), /stopped/);
});

test("WASM refreshes metadata through the actual SingleStore driver and preserves schema on failure",
    { timeout: 30000 }, async t => {
        const database = singlestore.createServer();
        const connections = new Set();
        const queries = [];
        let failQueries = false;
        database.on("connection", connection => {
            connections.add(connection);
            connection.on("error", error => {
                if (error.code !== "PROTOCOL_CONNECTION_LOST" && error.code !== "ECONNRESET") {
                    assert.fail(error);
                }
            });
            connection.stream.on("close", () => connections.delete(connection));
            connection.serverHandshake({
                protocolVersion: 10,
                serverVersion: "8.0.0",
                connectionId: 1,
                statusFlags: 2,
                characterSet: 45,
                capabilityFlags: 0x00088209,
                authCallback(auth, callback) {
                    assert.equal(auth.user, "metadata_reader");
                    assert.equal(auth.database, "demo");
                    callback(null);
                    connection._resetSequenceId();
                },
            });
            connection.on("stmt_prepare", () => {
                connection.writeOk();
                connection._resetSequenceId();
            });
            connection.on("query", sql => {
                queries.push(sql);
                if (failQueries) {
                    connection.writeError({ code: 1142, message: "metadata access denied" });
                    connection._resetSequenceId();
                    return;
                }
                let columns;
                let rows = [];
                if (sql === "SELECT DATABASE()") {
                    columns = ["DATABASE()"];
                    rows = [["demo"]];
                } else if (sql.startsWith("SELECT ") && sql.includes(" FROM INFORMATION_SCHEMA.")) {
                    columns = sql.slice(7, sql.indexOf(" FROM ")).split(", ");
                    if (sql.endsWith(".SCHEMATA")) {
                        rows = [["demo"]];
                    } else if (sql.endsWith(".TABLES")) {
                        rows = [["demo", "wasm_accounts", "BASE TABLE"]];
                    } else if (sql.endsWith(".COLUMNS")) {
                        rows = [["demo", "wasm_accounts", "account_id", "bigint"]];
                    }
                } else if (sql.startsWith("SHOW ")) {
                    columns = ["Name", "Value", "Type"];
                } else {
                    assert.fail(`Unexpected metadata SQL: ${sql}`);
                }
                connection.writeColumns(columns.map(name => ({
                    catalog: "def", schema: "", table: "", orgTable: "", orgName: name,
                    name, columnType: singlestore.Types.VAR_STRING,
                    characterSet: 45, columnLength: 255, flags: 0, decimals: 0,
                })));
                rows.forEach(row => connection.writeTextRow(row));
                connection.writeEof();
                connection._resetSequenceId();
            });
        });
        database.listen(0, "127.0.0.1");
        await once(database._server, "listening");
        const server = new WasmServer({
            host: "127.0.0.1",
            port: database._server.address().port,
            username: "metadata_reader",
            password: "",
            database: "demo",
            ssl: false,
        }, error => assert.fail(error));
        t.after(async () => {
            await server.stop();
            for (const connection of connections) {
                connection.stream.destroy();
            }
            await new Promise(resolve => database.close(resolve));
        });

        await server.request("initialize");
        await server.request("refreshSchema");
        assert.ok(queries.includes("SELECT DATABASE()"));
        assert.ok(queries.some(sql => sql.includes("INFORMATION_SCHEMA.COLUMNS")));
        const tables = await complete(server, "SELECT * FROM ");
        assert.ok(tables.completions.some(item => item.label === "wasm_accounts"));
        const columns = await complete(server, "SELECT wasm_accounts.", 2);
        assert.ok(columns.completions.some(item => item.label === "account_id"));
        failQueries = true;
        await assert.rejects(server.request("refreshSchema"), /metadata access denied/);
        const cached = await complete(server, "SELECT * FROM ", 3);
        assert.ok(cached.completions.some(item => item.label === "wasm_accounts"));
    });
