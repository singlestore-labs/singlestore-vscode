export interface DatabaseConfig {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl: boolean;
}

export type SqlValue = string | number | boolean | null;

export interface SqlExecutionRequest {
    sql: string;
    parameters?: readonly SqlValue[];
    database?: string;
    maxRows?: number;
}

export interface SqlResult {
    columns: { name: string }[];
    rows: SqlValue[][];
    rowCount: number;
}

export interface Position {
    line: number;
    character: number;
}

export interface WasmCompletion {
    label: string;
    kind?: number;
    detail?: string;
    sortText?: string;
    filterText?: string;
    insertText?: string;
    range?: { start: Position; end: Position } | null;
    deprecated?: boolean;
    preselect?: boolean;
    commitChars?: string[] | null;
}

export interface CompletionResult {
    completions: WasmCompletion[] | null;
    isIncomplete: boolean;
}

export interface SemanticLegend {
    tokenTypes: string[];
    tokenModifiers: string[];
}

export interface DocumentSnapshot {
    uri: string;
    text: string;
    version: number;
}

export interface ServerRequests {
    initialize: { params: undefined; result: SemanticLegend };
    refreshSchema: { params: undefined; result: void };
    complete: {
        params: DocumentSnapshot & { position: Position };
        result: CompletionResult;
    };
    semanticTokens: { params: DocumentSnapshot; result: number[] };
    close: { params: { uri: string }; result: void };
}

export type ServerRequest = {
    [K in keyof ServerRequests]: {
        id: number;
        method: K;
        params: ServerRequests[K]["params"];
    };
}[keyof ServerRequests];

export type ServerResponse = {
    id: number;
    result?: ServerRequests[keyof ServerRequests]["result"];
    error?: string;
};

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
