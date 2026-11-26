import { createPool, Pool, PoolConnection } from "singlestore-nodejs/promise";
import { readFileSync } from "fs";
import * as path from "path";
import { DatabaseConfig, SqlExecutionRequest, SqlResult, SqlValue } from "./wasmTypes";

export function getProgramAttributes(): { program_name: string; program_version: string } {
    const manifest: unknown = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    if (!manifest || typeof manifest !== "object" || !("name" in manifest) || !("version" in manifest) ||
        typeof manifest.name !== "string" || !manifest.name ||
        typeof manifest.version !== "string" || !manifest.version) {
        throw new Error("Extension package.json must contain a name and version.");
    }
    return { program_name: manifest.name, program_version: manifest.version };
}

export function sqlValue(value: unknown): SqlValue {
    if (value === null || typeof value === "string" ||
        typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Buffer.isBuffer(value)) {
        return value.toString("utf8");
    }
    throw new Error(`Unsupported SQL result value: ${typeof value}`);
}

export class SqlExecutor {
    private readonly pools = new Map<string, Pool>();
    private readonly programAttributes = getProgramAttributes();

    constructor(private readonly config: DatabaseConfig) {}

    async execute(
        request: SqlExecutionRequest,
        options?: { signal?: AbortSignal }
    ): Promise<SqlResult> {
        const signal = options?.signal;
        signal?.throwIfAborted();
        if (request.maxRows !== undefined &&
            (!Number.isInteger(request.maxRows) || request.maxRows < 0)) {
            throw new Error("maxRows must be a non-negative integer");
        }
        const database = request.database ?? this.config.database;
        let pool = this.pools.get(database);
        if (!pool) {
            pool = createPool({
                host: this.config.host,
                port: this.config.port,
                user: this.config.username,
                password: this.config.password,
                database: database || undefined,
                ssl: this.config.ssl ? { rejectUnauthorized: true } : undefined,
                connectionLimit: 2,
                connectTimeout: 10000,
                rowsAsArray: true,
                supportBigNumbers: true,
                bigNumberStrings: true,
                dateStrings: true,
                jsonStrings: true,
                multipleStatements: false,
                connectAttributes: this.programAttributes,
            });
            this.pools.set(database, pool);
        }

        let connection: PoolConnection | undefined;
        let abort: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => {
            abort = () => {
                connection?.destroy();
                reject(signal?.reason ?? new Error("SQL execution aborted"));
            };
        });
        signal?.addEventListener("abort", abort, { once: true });
        try {
            connection = await Promise.race([
                pool.getConnection().then(acquired => {
                    if (signal?.aborted) {
                        acquired.destroy();
                    }
                    return acquired;
                }),
                aborted,
            ]);
            signal?.throwIfAborted();
            const [rows, fields] = await Promise.race([
                connection.query({
                    sql: request.sql,
                    values: request.parameters ? [...request.parameters] : [],
                    timeout: 30000,
                }),
                aborted,
            ]);
            signal?.throwIfAborted();
            if (!Array.isArray(rows)) {
                return { columns: [], rows: [], rowCount: rows.affectedRows };
            }
            const values = request.maxRows === undefined ? rows : rows.slice(0, request.maxRows);
            return {
                columns: fields.map(field => ({ name: field.name })),
                rows: values.map((row: unknown) => {
                    if (!Array.isArray(row)) {
                        throw new Error("SQL executor expected positional rows");
                    }
                    return row.map(sqlValue);
                }),
                rowCount: values.length,
            };
        } catch (error) {
            connection?.destroy();
            throw error;
        } finally {
            signal?.removeEventListener("abort", abort);
            connection?.release();
        }
    }
}
