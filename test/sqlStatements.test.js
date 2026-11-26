const assert = require("node:assert/strict");
const test = require("node:test");
const { parseSql, statementAtCursor, statementsInSelection } = require("../out/sqlStatements");

test("splits SQL using active delimiters without splitting quoted text or comments", () => {
    const text = [
        "SELECT ';', `a;b`, 'it\\'s;ok'; -- ;",
        "DELIMITER //",
        "CREATE PROCEDURE p() BEGIN",
        " SELECT 'x//y'; # //",
        " SELECT 2; /* // */",
        "END//",
        "DELIMITER ;",
        "SELECT 3;",
    ].join("\n");
    const statements = parseSql(text).statements;
    assert.equal(statements.length, 3);
    assert.match(statements[1].sql, /^CREATE PROCEDURE/);
    assert.match(statements[1].sql, /SELECT 2;/);
    assert.equal(statementAtCursor(text, text.indexOf("SELECT 2")).sql, statements[1].sql);
    assert.equal(statementAtCursor(text, text.lastIndexOf("SELECT 3")).sql, "SELECT 3");
    const from = text.indexOf("CREATE PROCEDURE");
    const to = text.indexOf("\nDELIMITER ;");
    assert.equal(statementsInSelection(text, from, to)[0].sql, statements[1].sql);
    assert.equal(statementsInSelection(text, from, to).length, 1);
});

test("reports unterminated input and ignores comment-only segments", () => {
    assert.deepEqual(parseSql("-- comment;\n/* ; */; # only").statements, []);
    assert.throws(() => parseSql("SELECT 'oops;"), /Unterminated/);
    assert.throws(() => parseSql("SELECT 1 /* oops"), /Unterminated/);
    assert.throws(() => parseSql("DELIMITER\nSELECT 1;"), /DELIMITER requires/);
    assert.deepEqual(parseSql("SELECT 1; SELECT 2").statements.map(x => x.sql), ["SELECT 1", "SELECT 2"]);
    assert.equal(statementAtCursor("SELECT 1; SELECT 'unfinished", 2).sql, "SELECT 1");
    assert.throws(() => statementAtCursor("SELECT 1; SELECT 'unfinished", 15), /Unterminated/);
});
