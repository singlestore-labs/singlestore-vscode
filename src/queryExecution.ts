import { createConnection, Connection, FieldPacket } from "singlestore-nodejs";
import { DatabaseConfig, SqlValue } from "./wasmTypes";
import { getProgramAttributes, sqlValue } from "./sqlExecutor";

export interface QueryResultSet {
    columns: string[];
    rows: SqlValue[][];
    totalRows: number;
    affectedRows?: number;
}

export async function testConnection(config: DatabaseConfig): Promise<void> {
    const session = new QuerySession(config);
    try {
        await session.connect();
    } finally {
        session.dispose();
    }
}

export class QuerySession {
    private readonly connection: Connection;
    private readonly controller = new AbortController();
    private connectionError: Error | undefined;

    constructor(config: DatabaseConfig) {
        this.connection = createConnection({
            host: config.host, port: config.port, user: config.username, password: config.password,
            database: config.database || undefined,
            ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
            connectTimeout: 10000, rowsAsArray: true, supportBigNumbers: true,
            bigNumberStrings: true, dateStrings: true, jsonStrings: true,
            multipleStatements: false, connectAttributes: getProgramAttributes(),
        });
        this.connection.on("error", (error: Error) => {
            this.connectionError = error;
            this.controller.abort(error);
        });
    }

    get failure(): unknown {
        return this.controller.signal.aborted ? this.controller.signal.reason : undefined;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const signal = this.controller.signal;
            const abort = () => reject(signal.reason ?? new Error("Connection closed."));
            if (signal.aborted) return abort();
            signal.addEventListener("abort", abort, { once: true });
            this.connection.connect(error => {
                signal.removeEventListener("abort", abort);
                if (error) reject(error);
                else if (signal.aborted) abort();
                else resolve();
            });
        });
    }

    execute(sql: string, maxRows: number): Promise<QueryResultSet[]> {
        if (!Number.isSafeInteger(maxRows) || maxRows < 1) {
            return Promise.reject(new Error("Result row limit must be a positive integer."));
        }
        return new Promise((resolve, reject) => {
            const signal = this.controller.signal;
            if (signal.aborted) {
                reject(signal.reason ?? new Error("Connection closed."));
                return;
            }
            const results: QueryResultSet[] = [];
            let current: QueryResultSet | undefined;
            let resultError: unknown;
            const abort = () => reject(signal.reason ?? new Error("Connection closed."));
            signal.addEventListener("abort", abort, { once: true });
            const query = this.connection.query({ sql, rowsAsArray: true });
            query.on("fields", (fields: FieldPacket[] | undefined) => {
                current = { columns: fields?.map(field => field.name) ?? [], rows: [], totalRows: 0 };
                results.push(current);
            });
            query.on("result", (row: unknown) => {
                if (!current) {
                    resultError = new Error("SQL result arrived without column information.");
                } else if (Array.isArray(row)) {
                    current.totalRows++;
                    if (current.rows.length < maxRows && !resultError) {
                        try {
                            current.rows.push(row.map(sqlValue));
                        } catch (error) {
                            resultError = error;
                        }
                    }
                } else if (row && typeof row === "object" && "affectedRows" in row &&
                    typeof row.affectedRows === "number") {
                    current.affectedRows = row.affectedRows;
                } else {
                    resultError = new Error("Unexpected SQL result.");
                }
            });
            query.on("error", (error: Error) => { resultError = error; });
            query.on("end", () => {
                signal.removeEventListener("abort", abort);
                if (resultError) reject(resultError);
                else if (signal.aborted) abort();
                else resolve(results);
            });
        });
    }

    dispose(): void {
        this.controller.abort(this.connectionError ?? new Error("Query connection closed."));
        this.connection.destroy();
    }
}
