const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const driver = require("singlestore-nodejs");
const { QuerySession } = require("../out/queryExecution");

test("streams capped results and executes successive statements on the same connection", { timeout: 15000 }, async t => {
    const server = driver.createServer();
    const connections = new Set();
    const queries = [];
    let waiting;
    const waitStarted = new Promise(resolve => { waiting = resolve; });
    server.on("connection", connection => {
        connections.add(connection);
        connection.on("error", () => {});
        connection.stream.on("close", () => connections.delete(connection));
        connection.serverHandshake({
            protocolVersion: 10, serverVersion: "8.0.0", connectionId: 1,
            statusFlags: 2, characterSet: 45, capabilityFlags: 0x00088209,
            authCallback(_auth, callback) { callback(null); connection._resetSequenceId(); },
        });
        connection.on("stmt_prepare", () => {
            connection.writeOk();
            connection._resetSequenceId();
        });
        connection.on("query", sql => {
            queries.push(sql);
            if (sql === "WAIT") {
                waiting();
                return;
            } else if (sql === "BAD") {
                connection.writeError({ code: 1064, message: "bad statement" });
            } else if (sql === "UPDATE t SET x=1") {
                connection.writeOk({ affectedRows: 3 });
            } else {
                connection.writeColumns(["x", "x"].map(name => ({
                    catalog: "def", schema: "", table: "", orgTable: "", orgName: name,
                    name, columnType: driver.Types.VAR_STRING,
                    characterSet: 45, columnLength: 255, flags: 0, decimals: 0,
                })));
                for (let i = 0; i < 205; i++) connection.writeTextRow([String(i), "<value>"]);
                connection.writeEof();
            }
            connection._resetSequenceId();
        });
    });
    server.listen(0, "127.0.0.1");
    await once(server._server, "listening");
    const session = new QuerySession({
        host: "127.0.0.1", port: server._server.address().port,
        username: "test", password: "", database: "", ssl: false,
    });
    t.after(async () => {
        session.dispose();
        for (const connection of connections) connection.stream.destroy();
        await new Promise(resolve => server.close(resolve));
    });
    await session.connect();
    const [result] = await session.execute("SELECT test", 200);
    assert.deepEqual(result.columns, ["x", "x"]);
    assert.equal(result.rows.length, 200);
    assert.equal(result.totalRows, 205);
    assert.deepEqual(result.rows[0], ["0", "<value>"]);
    const [updated] = await session.execute("UPDATE t SET x=1", 200);
    assert.equal(updated.affectedRows, 3);
    await assert.rejects(session.execute("BAD", 200), /bad statement/);
    assert.deepEqual(queries, ["SELECT test", "UPDATE t SET x=1", "BAD"]);
    assert.equal(connections.size, 1);
    const pending = session.execute("WAIT", 200);
    await waitStarted;
    session.dispose();
    await assert.rejects(pending, /connection closed/i);
});
