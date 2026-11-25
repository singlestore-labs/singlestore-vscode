import * as path from "path";
import { Worker } from "worker_threads";
import { DatabaseConfig, ServerRequests, ServerResponse } from "./wasmTypes";

export class WasmServer {
    private readonly worker: Worker;
    private nextId = 0;
    private stopped = false;
    private readonly pending = new Map<number, {
        resolve: (value: ServerResponse["result"]) => void;
        reject: (error: Error) => void;
    }>();

    constructor(config: DatabaseConfig | undefined, onError: (error: Error) => void) {
        this.worker = new Worker(path.join(__dirname, "wasmWorker.js"), { workerData: config });
        this.worker.on("message", (response: ServerResponse) => {
            const pending = this.pending.get(response.id);
            if (!pending) {
                return;
            }
            this.pending.delete(response.id);
            if (response.error !== undefined) {
                pending.reject(new Error(response.error));
            } else {
                pending.resolve(response.result);
            }
        });
        this.worker.on("error", error => {
            this.fail(error);
            onError(error);
        });
        this.worker.on("exit", code => {
            if (!this.stopped) {
                const error = new Error(`WASM server exited with code ${code}`);
                this.fail(error);
                onError(error);
            }
        });
    }

    request<K extends keyof ServerRequests>(
        method: K, params: ServerRequests[K]["params"]
    ): Promise<ServerRequests[K]["result"]> {
        if (this.stopped) {
            return Promise.reject(new Error("WASM server is stopped"));
        }
        const id = this.nextId++;
        return new Promise<ServerRequests[K]["result"]>((resolve, reject) => {
            this.pending.set(id, {
                // Each response ID belongs to exactly one typed request.
                resolve: value => resolve(value as ServerRequests[K]["result"]),
                reject,
            });
            this.worker.postMessage({ id, method, params });
        });
    }

    private fail(error: Error): void {
        this.stopped = true;
        for (const request of this.pending.values()) {
            request.reject(error);
        }
        this.pending.clear();
    }

    async stop(): Promise<void> {
        this.fail(new Error("WASM server stopped"));
        await this.worker.terminate();
    }
}
