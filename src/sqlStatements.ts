export interface SqlStatement {
    sql: string;
    start: number;
    end: number;
}

interface ParsedSql {
    statements: SqlStatement[];
    delimiters: { offset: number; value: string }[];
}

export function parseSql(text: string, initialDelimiter = ";", strict = true): ParsedSql {
    const statements: SqlStatement[] = [];
    const delimiters: { offset: number; value: string }[] = [];
    let delimiter = initialDelimiter;
    let start = 0;
    let hasSql = false;
    let i = 0;

    while (i < text.length) {
        const lineStart = i === 0 || text[i - 1] === "\n";
        if (lineStart && !hasSql) {
            const lineEnd = text.indexOf("\n", i);
            const end = lineEnd < 0 ? text.length : lineEnd;
            const line = text.slice(i, end).replace(/\r$/, "");
            const directive = /^\s*DELIMITER(?:\s+(\S+))?\s*$/i.exec(line);
            if (directive) {
                if (!directive[1]) throw new Error("DELIMITER requires a non-empty delimiter.");
                delimiter = directive[1];
                i = lineEnd < 0 ? end : end + 1;
                delimiters.push({ offset: i, value: delimiter });
                start = i;
                continue;
            }
        }
        if (text.startsWith(delimiter, i)) {
            if (hasSql) statements.push({ sql: text.slice(start, i).trim(), start, end: i + delimiter.length });
            i += delimiter.length;
            start = i;
            hasSql = false;
            continue;
        }
        const char = text[i];
        if (char === "'" || char === '"' || char === "`") {
            hasSql = true;
            const quote = char;
            i++;
            let closed = false;
            while (i < text.length) {
                if (text[i] === "\\" && i + 1 < text.length) {
                    i += 2;
                } else if (text[i] === quote) {
                    if (text[i + 1] === quote) i += 2;
                    else { i++; closed = true; break; }
                } else i++;
            }
            if (!closed && strict) throw new Error("Unterminated quoted SQL value or identifier.");
            continue;
        }
        if (char === "#" || (text.startsWith("--", i) && (i + 2 === text.length || /\s/.test(text[i + 2])))) {
            const end = text.indexOf("\n", i);
            i = end < 0 ? text.length : end;
            continue;
        }
        if (text.startsWith("/*", i)) {
            if (text[i + 2] === "!") hasSql = true;
            const end = text.indexOf("*/", i + 2);
            if (end < 0) {
                if (strict) throw new Error("Unterminated SQL comment.");
                i = text.length;
            } else i = end + 2;
            continue;
        }
        if (!/\s/.test(char)) hasSql = true;
        i++;
    }
    if (hasSql) statements.push({ sql: text.slice(start).trim(), start, end: text.length });
    return { statements, delimiters };
}

export function statementsInSelection(text: string, start: number, end: number): SqlStatement[] {
    const prefix = parseSql(text.slice(0, start), ";", false);
    const delimiter = prefix.delimiters.length ? prefix.delimiters[prefix.delimiters.length - 1].value : ";";
    return parseSql(text.slice(start, end), delimiter).statements;
}

export function statementAtCursor(text: string, offset: number): SqlStatement | undefined {
    const parsed = parseSql(text, ";", false);
    const statement = parsed.statements.find(item => offset >= item.start && offset < item.end)
        ?? (offset === text.length ? parsed.statements.find(item => item.end === offset) : undefined);
    if (statement) {
        const delimiter = parsed.delimiters.filter(item => item.offset <= statement.start).pop()?.value ?? ";";
        parseSql(text.slice(statement.start, statement.end), delimiter);
    }
    return statement;
}
