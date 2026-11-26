const assert = require("node:assert/strict");
const test = require("node:test");
const { SchemaCapture } = require("../out/schemaCatalog");

function capture(builder, sql, rows) {
    builder.capture({ sql }, { columns: [], rows, rowCount: rows.length });
}

function child(parent, name) {
    return (Array.isArray(parent) ? parent : parent.children).find(item => item.name === name);
}

test("metadata capture builds database and cluster objects using the existing query results", () => {
    const builder = new SchemaCapture();
    builder.begin();
    capture(builder, "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA", [["Demo"]]);
    capture(builder, "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES", [
        ["demo", "accounts", "BASE TABLE"], ["Demo", "summary", "VIEW"], ["demo", "temp", "TEMPORARY TABLE"],
    ]);
    capture(builder, "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS", [
        ["DEMO", "accounts", "id", "bigint"],
    ]);
    capture(builder, "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS", [
        ["Demo", "accounts", "PRIMARY", "id"], ["demo", "accounts", "primary", "tenant"],
    ]);
    capture(builder, "SELECT DATABASE_NAME, PIPELINE_NAME FROM INFORMATION_SCHEMA.PIPELINES", [["Demo", "events"]]);
    capture(builder, "SELECT DATABASE_NAME, LINK FROM INFORMATION_SCHEMA.LINKS", [["Demo", "storage"]]);
    capture(builder, "SELECT AGGREGATE_SCHEMA, AGGREGATE_NAME FROM INFORMATION_SCHEMA.AGGREGATE_FUNCTIONS", [["Demo", "total"]]);
    capture(builder, "SHOW EXTENSIONS FROM Demo", [["extension1"]]);
    capture(builder, "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE FROM INFORMATION_SCHEMA.ROUTINES", [
        ["Demo", "calculate", "FUNCTION"], ["Demo", "ingest", "PROCEDURE"],
    ]);
    capture(builder, "SELECT SPECIFIC_SCHEMA, SPECIFIC_NAME, PARAMETER_NAME FROM INFORMATION_SCHEMA.PARAMETERS", [
        ["Demo", "calculate", null], ["Demo", "calculate", "input"],
    ]);
    capture(builder, "SELECT PROJECTION_SCHEMA, PROJECTION_NAME, BASE_TABLE_NAME FROM INFORMATION_SCHEMA.PROJECTIONS", [
        ["Demo", "by_tenant", "accounts"],
    ]);
    capture(builder, "SHOW RESULT TABLES", [["Demo", "namespace", "result", "", "", ""]]);
    capture(builder, "SELECT POOL_NAME FROM INFORMATION_SCHEMA.RESOURCE_POOLS", [["default_pool"]]);
    capture(builder, "SELECT GROUPNAME FROM INFORMATION_SCHEMA.GROUPS", [["devs"]]);
    capture(builder, "SELECT USER FROM INFORMATION_SCHEMA.USERS", [["developer"]]);
    capture(builder, "SELECT ROLE FROM INFORMATION_SCHEMA.ROLES", [["reader"]]);
    capture(builder, "SELECT HOST, PORT FROM INFORMATION_SCHEMA.LEAVES", [["leaf.local", 3306]]);
    capture(builder, "SELECT HOST, PORT FROM INFORMATION_SCHEMA.AGGREGATORS", [["agg.local", "3306"]]);
    capture(builder, "SELECT CHARACTER_SET_NAME FROM INFORMATION_SCHEMA.CHARACTER_SETS", [["utf8mb4"]]);
    capture(builder, "SELECT COLLATION_NAME FROM INFORMATION_SCHEMA.COLLATIONS", [["utf8mb4_general_ci"]]);
    capture(builder, "SELECT VARIABLE_NAME, VARIABLE_VALUE FROM INFORMATION_SCHEMA.USER_VARIABLES", [["token", "do-not-display"]]);
    capture(builder, "SHOW SESSION VARIABLES EXTENDED", [["setting", "session", "Local"]]);
    capture(builder, "SHOW GLOBAL VARIABLES EXTENDED", [["setting", "global", "Local"]]);
    const catalog = builder.commit();
    const database = child(child(catalog.objects, "Databases"), "Demo");
    const table = child(child(database, "Tables"), "accounts");
    assert.equal(child(child(table, "Columns"), "id").detail, "bigint");
    const indexes = child(table, "Indexes");
    assert.equal(indexes.children.length, 1);
    assert.deepEqual(indexes.children[0].children.map(item => item.name), ["id", "tenant"]);
    assert.equal(child(child(database, "Views"), "summary").kind, "view");
    assert.equal(child(child(database, "Temporary Tables"), "temp").kind, "table");
    for (const [category, name] of [
        ["Pipelines", "events"], ["Links", "storage"], ["Aggregates", "total"],
        ["Extensions", "extension1"], ["Functions", "calculate"], ["Procedures", "ingest"],
        ["Projections", "by_tenant"], ["Result Tables", "result"],
    ]) assert.ok(child(child(database, category), name));
    assert.equal(child(child(child(child(database, "Functions"), "calculate"), "Parameters"), "input").kind, "parameter");
    assert.equal(child(child(table, "Projections"), "by_tenant").detail, "accounts");
    for (const [category, name] of [
        ["Groups", "devs"], ["Users", "developer"], ["Roles", "reader"],
        ["Resource Pools", "default_pool"], ["Character Sets", "utf8mb4"],
        ["Collations", "utf8mb4_general_ci"], ["User Variables", "token"],
    ]) assert.ok(child(child(catalog.objects, category), name));
    assert.equal(child(catalog.objects, "System Variables").children.length, 1);
    assert.ok(child(child(child(catalog.objects, "Hosts"), "Leaves"), "leaf.local:3306"));
    assert.ok(child(child(child(catalog.objects, "Hosts"), "Aggregators"), "agg.local:3306"));
    assert.equal(JSON.stringify(catalog).includes("do-not-display"), false);
});

test("capture discards failed refreshes, handles empty results and legacy queries, and ignores unrelated SQL", () => {
    const builder = new SchemaCapture();
    builder.begin();
    capture(builder, "SHOW GROUPS", [["old-group"]]);
    capture(builder, "SHOW ROLES", [["reader"]]);
    builder.commit();
    builder.begin();
    capture(builder, "SHOW GROUPS", [["partial"]]);
    builder.discard();
    builder.begin();
    capture(builder, "SELECT @@memsql_version", [["10.1.0"]]);
    const retained = builder.commit();
    assert.equal(child(retained.objects, "Groups").children[0].name, "old-group");
    builder.begin();
    capture(builder, "SHOW GROUPS", []);
    const empty = builder.commit();
    assert.deepEqual(child(empty.objects, "Groups").children, []);
    assert.equal(child(empty.objects, "Roles").children[0].name, "reader");
    builder.begin();
    capture(builder, "SELECT USER FROM INFORMATION_SCHEMA.USERS", [[null]]);
    assert.throws(() => builder.commit(), /Unexpected metadata value/);
    builder.discard();
});
