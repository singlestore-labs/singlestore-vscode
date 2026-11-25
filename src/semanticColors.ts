import * as vscode from "vscode";

export const SEMANTIC_TOKEN_TYPES = [
    "unknown", "identifier", "string", "number", "operator", "keyword", "end_of_query", "comment",
] as const;
export type SemanticTokenType = typeof SEMANTIC_TOKEN_TYPES[number];

export function semanticTokenId(type: string): string {
    return "singlestore" + type.split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

type TokenStyle = string | { foreground?: string; [key: string]: unknown };
interface SemanticColorCustomizations {
    rules?: Record<string, TokenStyle>;
    [key: string]: unknown;
}

export function getSemanticColors(): Record<string, string> {
    const config = vscode.workspace.getConfiguration("editor");
    const customizations = config.inspect<SemanticColorCustomizations>("semanticTokenColorCustomizations")?.globalValue;
    const colors: Record<string, string> = {};
    for (const type of SEMANTIC_TOKEN_TYPES) {
        const style = customizations?.rules?.[semanticTokenId(type)];
        const color = typeof style === "string" ? style : style?.foreground;
        if (color) {
            colors[type] = color;
        }
    }
    return colors;
}

export async function saveSemanticColors(colors: unknown): Promise<void> {
    if (!colors || typeof colors !== "object" || Array.isArray(colors)) {
        throw new Error("Semantic token colors must be an object.");
    }
    const values: Record<string, unknown> = Object.assign(Object.create(null), colors);
    for (const key of Object.keys(values)) {
        if (!(SEMANTIC_TOKEN_TYPES as readonly string[]).includes(key)) {
            throw new Error(`Unknown semantic token type: ${key}`);
        }
    }
    const validated: Record<string, string> = {};
    for (const [type, value] of Object.entries(values)) {
        if (typeof value !== "string" || (value !== "" && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value))) {
            throw new Error(`Color for ${type} must be empty or a three- or six-digit hex color.`);
        }
        validated[type] = value;
    }
    if (!Object.keys(values).length) {
        return;
    }
    const config = vscode.workspace.getConfiguration("editor");
    const existing = config.inspect<SemanticColorCustomizations>("semanticTokenColorCustomizations")?.globalValue ?? {};
    const rules = { ...existing.rules };
    for (const [type, value] of Object.entries(validated)) {
        const id = semanticTokenId(type);
        if (value === "") {
            const style = rules[id];
            if (style && typeof style === "object") {
                const { foreground, ...rest } = style;
                if (Object.keys(rest).length) {
                    rules[id] = rest;
                } else {
                    delete rules[id];
                }
            } else {
                delete rules[id];
            }
        } else {
            const style = rules[id];
            rules[id] = style && typeof style === "object" ? { ...style, foreground: value } : value;
        }
    }
    const updated = { ...existing };
    if (Object.keys(rules).length) {
        updated.rules = rules;
    } else {
        delete updated.rules;
    }
    await config.update("semanticTokenColorCustomizations",
        Object.keys(updated).length ? updated : undefined, vscode.ConfigurationTarget.Global);
}
