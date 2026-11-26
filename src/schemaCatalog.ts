import { SqlExecutionRequest, SqlResult, SqlValue } from "./wasmTypes";

export interface SchemaObject {
    name: string;
    kind: string;
    detail?: string;
    children?: SchemaObject[];
}

export interface SchemaCatalog {
    objects: SchemaObject[];
    refreshedAt: string;
}

const metadataTables = new Set([
    "SCHEMATA", "TABLES", "COLUMNS", "STATISTICS", "PIPELINES", "LINKS",
    "AGGREGATE_FUNCTIONS", "ROUTINES", "PARAMETERS", "PROJECTIONS",
    "LEAVES", "AGGREGATORS", "RESOURCE_POOLS", "GROUPS", "USERS", "ROLES",
    "CHARACTER_SETS", "COLLATIONS", "USER_VARIABLES",
]);

function queryKey(sql: string): string | undefined {
    const normalized = sql.trim().replace(/\s+/g, " ");
    const table = /^SELECT .+ FROM INFORMATION_SCHEMA\.([A-Z_]+)$/i.exec(normalized)?.[1].toUpperCase();
    if (table && metadataTables.has(table)) return table;
    if (/^SHOW (GROUPS|ROLES|RESULT TABLES|SESSION VARIABLES EXTENDED|GLOBAL VARIABLES EXTENDED)$/i.test(normalized)) {
        return normalized.toUpperCase();
    }
    if (/^SHOW EXTENSIONS FROM /i.test(normalized)) {
        return "EXTENSIONS:" + normalized.slice("SHOW EXTENSIONS FROM ".length);
    }
    return undefined;
}

export class SchemaCapture {
    private results = new Map<string, SqlResult>();
    private pending: Map<string, SqlResult> | undefined;

    begin(): void {
        this.pending = new Map(this.results);
    }

    capture(request: SqlExecutionRequest, result: SqlResult): void {
        const key = queryKey(request.sql);
        if (key && this.pending) {
            this.pending.set(key, result);
        }
    }

    commit(): SchemaCatalog {
        if (!this.pending) throw new Error("No schema capture is in progress.");
        const catalog = buildCatalog(this.pending);
        this.results = this.pending;
        this.pending = undefined;
        return catalog;
    }

    discard(): void {
        this.pending = undefined;
    }
}

function buildCatalog(results: Map<string, SqlResult>): SchemaCatalog {
    const objects: SchemaObject[] = [];
    const databases = new Map<string, SchemaObject>();
    const tables = new Map<string, SchemaObject>();
    const routines = new Map<string, SchemaObject>();
    const rows = (key: string): SqlValue[][] => results.get(key)?.rows ?? [];
    const key = (database: string, name: string): string => JSON.stringify([database.toLowerCase(), name.toLowerCase()]);
    const text = (row: SqlValue[], index: number, source: string): string => {
        const value = row[index];
        if (typeof value !== "string") {
            throw new Error(`Unexpected metadata value in ${source}, column ${index + 1}.`);
        }
        return value;
    };
    const folder = (parent: SchemaObject[], name: string): SchemaObject[] => {
        let entry = parent.find(item => item.kind === "category" && item.name === name);
        if (!entry) {
            entry = { name, kind: "category", children: [] };
            parent.push(entry);
        }
        return entry.children!;
    };
    const databaseChildren = (name: string): SchemaObject[] | undefined => databases.get(name.toLowerCase())?.children;
    const addDatabaseObject = (database: string, category: string, object: SchemaObject): void => {
        const parent = databaseChildren(database);
        if (parent) folder(parent, category).push(object);
    };
    for (const row of rows("SCHEMATA")) {
        const name = text(row, 0, "SCHEMATA");
        databases.set(name.toLowerCase(), { name, kind: "database", children: [] });
    }
    if (results.has("SCHEMATA")) {
        objects.push({ name: "Databases", kind: "category", children: [...databases.values()] });
    }
    const tableTypes: Record<string, string> = {
        "BASE TABLE": "Tables", "VIEW": "Views", "SYSTEM VIEW": "System Views",
        "TEMPORARY TABLE": "Temporary Tables", "GLOBAL TEMPORARY TABLE": "Global Temporary Tables",
    };
    for (const row of rows("TABLES")) {
        const database = text(row, 0, "TABLES");
        const name = text(row, 1, "TABLES");
        const type = text(row, 2, "TABLES");
        const category = tableTypes[type] ?? "Other Tables";
        const object: SchemaObject = { name, kind: type.includes("VIEW") ? "view" : "table", detail: type, children: [] };
        addDatabaseObject(database, category, object);
        tables.set(key(database, name), object);
    }
    for (const row of rows("COLUMNS")) {
        const table = tables.get(key(text(row, 0, "COLUMNS"), text(row, 1, "COLUMNS")));
        if (table?.children) {
            folder(table.children, "Columns").push({
                name: text(row, 2, "COLUMNS"), kind: "column", detail: text(row, 3, "COLUMNS"),
            });
        }
    }
    for (const row of rows("STATISTICS")) {
        const table = tables.get(key(text(row, 0, "STATISTICS"), text(row, 1, "STATISTICS")));
        if (!table?.children) continue;
        const indexes = folder(table.children, "Indexes");
        const name = text(row, 2, "STATISTICS");
        let index = indexes.find(item => item.name.toLowerCase() === name.toLowerCase());
        if (!index) {
            index = { name, kind: "index", children: [] };
            indexes.push(index);
        }
        if (row[3] !== null) {
            index.children!.push({ name: text(row, 3, "STATISTICS"), kind: "column" });
        }
    }
    for (const [source, category, kind] of [
        ["PIPELINES", "Pipelines", "pipeline"], ["LINKS", "Links", "link"],
        ["AGGREGATE_FUNCTIONS", "Aggregates", "function"],
    ]) {
        for (const row of rows(source)) {
            addDatabaseObject(text(row, 0, source), category, { name: text(row, 1, source), kind });
        }
    }
    for (const [source, result] of results) {
        if (!source.startsWith("EXTENSIONS:")) continue;
        const database = source.slice("EXTENSIONS:".length).replace(/^`(.*)`$/, "$1").replace(/``/g, "`");
        for (const row of result.rows) {
            addDatabaseObject(database, "Extensions", { name: text(row, 0, source), kind: "extension" });
        }
    }
    for (const row of rows("ROUTINES")) {
        const database = text(row, 0, "ROUTINES");
        const name = text(row, 1, "ROUTINES");
        const type = text(row, 2, "ROUTINES");
        const object: SchemaObject = { name, kind: "function", detail: type, children: [] };
        addDatabaseObject(database, type === "PROCEDURE" ? "Procedures" : "Functions", object);
        routines.set(key(database, name), object);
    }
    for (const row of rows("PARAMETERS")) {
        const routine = routines.get(key(text(row, 0, "PARAMETERS"), text(row, 1, "PARAMETERS")));
        if (routine?.children && row[2] !== null) {
            folder(routine.children, "Parameters").push({ name: text(row, 2, "PARAMETERS"), kind: "parameter" });
        }
    }
    for (const row of rows("PROJECTIONS")) {
        const database = text(row, 0, "PROJECTIONS");
        const name = text(row, 1, "PROJECTIONS");
        const tableName = text(row, 2, "PROJECTIONS");
        const object: SchemaObject = { name, kind: "projection", detail: tableName };
        addDatabaseObject(database, "Projections", object);
        const table = tables.get(key(database, tableName));
        if (table?.children) folder(table.children, "Projections").push(object);
    }
    for (const row of rows("SHOW RESULT TABLES")) {
        addDatabaseObject(text(row, 0, "SHOW RESULT TABLES"), "Result Tables", {
            name: text(row, 2, "SHOW RESULT TABLES"), kind: "table", detail: text(row, 1, "SHOW RESULT TABLES"),
        });
    }
    const globalCategories: [string[], string, string][] = [
        [["GROUPS", "SHOW GROUPS"], "Groups", "group"],
        [["USERS"], "Users", "user"], [["ROLES", "SHOW ROLES"], "Roles", "role"],
        [["RESOURCE_POOLS"], "Resource Pools", "pool"],
        [["CHARACTER_SETS"], "Character Sets", "text"],
        [["COLLATIONS"], "Collations", "text"],
        [["USER_VARIABLES"], "User Variables", "variable"],
        [["SHOW SESSION VARIABLES EXTENDED", "SHOW GLOBAL VARIABLES EXTENDED"], "System Variables", "variable"],
    ];
    for (const [sources, category, kind] of globalCategories) {
        const source = sources.filter(item => results.has(item));
        if (!source.length) continue;
        const entries = new Map<string, SchemaObject>();
        for (const name of source) {
            for (const row of rows(name)) {
                const value = text(row, 0, name);
                entries.set(value.toLowerCase(), { name: value, kind });
            }
        }
        objects.push({ name: category, kind: "category", children: [...entries.values()] });
    }
    for (const [source, category] of [["LEAVES", "Leaves"], ["AGGREGATORS", "Aggregators"]]) {
        if (!results.has(source)) continue;
        const hosts = rows(source).map(row => {
            const port = row[1];
            if (typeof port !== "number" && typeof port !== "string") {
                throw new Error(`Unexpected host port in ${source}.`);
            }
            return { name: `${text(row, 0, source)}:${port}`, kind: "host" };
        });
        folder(objects, "Hosts").push({ name: category, kind: "category", children: hosts });
    }
    const sort = (items: SchemaObject[]): void => {
        items.sort((a, b) => a.name.localeCompare(b.name));
        for (const item of items) if (item.children) sort(item.children);
    };
    sort(objects);
    return { objects, refreshedAt: new Date().toISOString() };
}
