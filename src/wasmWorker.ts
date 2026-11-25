import { webcrypto } from "crypto";
import { readFile } from "fs/promises";
import * as path from "path";
import { parentPort, workerData } from "worker_threads";
import { SqlExecutor } from "./sqlExecutor";
import {
    CompletionResult, DatabaseConfig, errorMessage, Position, ServerRequest,
} from "./wasmTypes";

interface ApiResult {
    status?: string;
    success?: boolean;
    error?: string;
}

interface WasmApi {
    initServer(executor?: Pick<SqlExecutor, "execute">): ApiResult;
    refreshSchema(): Promise<ApiResult>;
    didOpen(uri: string, text: string, languageId: string, version: number): ApiResult;
    didChange(uri: string, change: { baseVersion: number; version: number; text: string }): ApiResult;
    didClose(uri: string): ApiResult;
    completeDocument(uri: string, position: Position, version: number): CompletionResult & ApiResult;
}

interface GoRuntime {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
}

const port = parentPort;
if (!port) {
    throw new Error("The WASM server must run in a worker");
}

const runtime = globalThis as typeof globalThis & WasmApi & {
    Go: new () => GoRuntime;
};
if (!globalThis.crypto) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}
require(path.join(__dirname, "..", "wasm", "wasm_exec.js"));

function checked<T extends ApiResult>(result: T): T {
    if (result.error || result.success === false || result.status === "error") {
        throw new Error(result.error ?? "WASM server operation failed");
    }
    return result;
}

const versions = new Map<string, number>();
let initialized = false;
let refreshing = false;

async function handle(request: ServerRequest): Promise<unknown> {
    if (request.method === "initialize") {
        const go = new runtime.Go();
        const bytes = await readFile(path.join(__dirname, "..", "wasm", "server.wasm"));
        const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
        // Go registers its exports synchronously before yielding its main goroutine.
        void go.run(instance).then(() => {
            throw new Error("WASM server exited unexpectedly");
        });
        const config: DatabaseConfig | undefined = workerData;
        const executor = config ? new SqlExecutor(config) : undefined;
        checked(runtime.initServer(executor ? { execute: executor.execute.bind(executor) } : undefined));
        initialized = true;
        return;
    }
    if (!initialized) {
        throw new Error("WASM server is not initialized");
    }
    switch (request.method) {
        case "refreshSchema":
            if (refreshing) {
                throw new Error("A schema refresh is already running");
            }
            refreshing = true;
            try {
                checked(await runtime.refreshSchema());
            } finally {
                refreshing = false;
            }
            return;
        case "complete": {
            const { uri, text, version, position } = request.params;
            const previous = versions.get(uri);
            if (previous === undefined) {
                checked(runtime.didOpen(uri, text, "singlestore-sql", version));
            } else if (previous !== version) {
                checked(runtime.didChange(uri, { baseVersion: previous, version, text }));
            }
            versions.set(uri, version);
            return checked(runtime.completeDocument(uri, position, version));
        }
        case "close":
            if (versions.delete(request.params.uri)) {
                checked(runtime.didClose(request.params.uri));
            }
            return;
    }
}

port.on("message", (request: ServerRequest) => {
    void handle(request).then(
        result => port.postMessage({ id: request.id, result }),
        error => port.postMessage({ id: request.id, error: errorMessage(error) })
    );
});
