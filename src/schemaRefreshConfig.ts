export const DEFAULT_SCHEMA_REFRESH_MINUTES = 5;

export function isSchemaRefreshInterval(value: unknown): value is number {
    return value === 0 || value === 1 || value === 5 || value === 30 || value === 60;
}
