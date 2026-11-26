import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { DatabaseConfig } from "./wasmTypes";

export interface ConnectionProfile {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    databaseName: string;
    useSSL: boolean;
}

const PROFILES_KEY = "singlestore.connections";
const ACTIVE_PROFILE_KEY = "singlestore.activeConnection";
const LEGACY_MIGRATED_KEY = "singlestore.legacyConnectionMigrated";
const SECRET_PREFIX = "singlestore.connection.password.";

export class ConnectionStore {
    constructor(private readonly context: vscode.ExtensionContext) {}

    getProfiles(): ConnectionProfile[] {
        return this.context.globalState.get<ConnectionProfile[]>(PROFILES_KEY, []);
    }

    getActiveProfileId(): string | undefined {
        return this.context.globalState.get<string>(ACTIVE_PROFILE_KEY);
    }

    getActiveProfile(): ConnectionProfile | undefined {
        const id = this.getActiveProfileId();
        return this.getProfiles().find(profile => profile.id === id);
    }

    async saveProfile(
        values: Omit<ConnectionProfile, "id">,
        password: string,
        id?: string
    ): Promise<ConnectionProfile> {
        validateProfile(values);
        const profiles = this.getProfiles();
        const profile: ConnectionProfile = { ...values, id: id ?? randomUUID() };
        if (profiles.some(item => item.id !== id && item.name.toLocaleLowerCase() === profile.name.toLocaleLowerCase())) {
            throw new Error(`A connection named "${profile.name}" already exists.`);
        }
        const index = profiles.findIndex(item => item.id === profile.id);
        if (index < 0) {
            profiles.push(profile);
        } else {
            profiles[index] = profile;
        }
        await this.context.globalState.update(PROFILES_KEY, profiles);
        if (password) {
            await this.context.secrets.store(SECRET_PREFIX + profile.id, password);
        }
        return profile;
    }

    async getDatabaseConfig(id: string): Promise<DatabaseConfig> {
        const profile = this.getProfiles().find(item => item.id === id);
        if (!profile) {
            throw new Error("The selected SingleStore connection no longer exists.");
        }
        return {
            host: profile.host,
            port: profile.port,
            username: profile.username,
            password: await this.context.secrets.get(SECRET_PREFIX + profile.id) ?? "",
            database: profile.databaseName,
            ssl: profile.useSSL,
        };
    }

    async clearPassword(id: string): Promise<void> {
        await this.context.secrets.delete(SECRET_PREFIX + id);
    }

    async setActiveProfile(id: string | undefined): Promise<void> {
        if (id && !this.getProfiles().some(profile => profile.id === id)) {
            throw new Error("The selected SingleStore connection no longer exists.");
        }
        await this.context.globalState.update(ACTIVE_PROFILE_KEY, id);
    }

    async deleteProfile(id: string): Promise<void> {
        await this.context.globalState.update(
            PROFILES_KEY,
            this.getProfiles().filter(profile => profile.id !== id)
        );
        await this.clearPassword(id);
        if (this.getActiveProfileId() === id) {
            await this.setActiveProfile(undefined);
        }
    }

    async migrateLegacySettings(): Promise<void> {
        if (this.context.globalState.get<boolean>(LEGACY_MIGRATED_KEY, false)) {
            return;
        }
        const config = vscode.workspace.getConfiguration("singlestore");
        const host = config.get<string>("host", "").trim();
        const username = config.get<string>("username", "").trim();
        if (host && username && this.getProfiles().length === 0) {
            const profile = await this.saveProfile({
                name: "Migrated connection",
                host,
                port: config.get<number>("port", 3306),
                username,
                databaseName: config.get<string>("databaseName", "").trim(),
                useSSL: config.get<boolean>("useSSL", false),
            }, config.get<string>("password", ""));
            await this.setActiveProfile(profile.id);
        }
        for (const key of ["host", "port", "username", "password", "databaseName", "useSSL"]) {
            if (config.inspect(key)?.globalValue !== undefined) {
                await config.update(key, undefined, vscode.ConfigurationTarget.Global);
            }
        }
        await this.context.globalState.update(LEGACY_MIGRATED_KEY, true);
    }
}

function validateProfile(profile: Omit<ConnectionProfile, "id">): void {
    if (!profile.name.trim() || !profile.host.trim() || !profile.username.trim()) {
        throw new Error("Connection name, host, and username are required.");
    }
    if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
        throw new Error("Port must be an integer between 1 and 65535.");
    }
}
