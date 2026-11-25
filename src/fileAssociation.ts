import * as vscode from "vscode";

export const DEFAULT_FILE_PATTERN = "*.s2db.sql";
const LANGUAGE_ID = "singlestore-sql";
const MANAGED_PATTERN = "managedFileAssociation";

export function getFilePattern(): string {
    const pattern = vscode.workspace.getConfiguration("singlestore")
        .get<string>("filePattern", DEFAULT_FILE_PATTERN).trim();
    if (!pattern || pattern.includes("\\")) {
        throw new Error("The SingleStore file pattern must be a non-empty VS Code glob using / as the path separator.");
    }
    return pattern;
}

export function completionPattern(pattern: string): string {
    return pattern.includes("/") ? pattern : `**/${pattern}`;
}

export class FileAssociationManager implements vscode.Disposable {
    private work = Promise.resolve();
    private disposed = false;
    private lastWarning: string | undefined;

    constructor(private readonly state: vscode.Memento) {}

    update(): Promise<void> {
        this.work = this.work.then(() => this.synchronize()).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`SingleStore: Could not update file association. ${message}`);
        });
        return this.work;
    }

    private async synchronize(): Promise<void> {
        if (this.disposed) {
            return;
        }
        const pattern = getFilePattern();
        const files = vscode.workspace.getConfiguration("files");
        const inspection = files.inspect<Record<string, string>>("associations");
        if (!inspection) {
            throw new Error("VS Code file associations are unavailable.");
        }
        const globalAssociations: Record<string, string> = Object.assign(
            Object.create(null), inspection.globalValue
        );
        const previous = this.state.get<string>(MANAGED_PATTERN);
        let changed = false;
        if (previous && previous !== pattern && globalAssociations[previous] === LANGUAGE_ID) {
            delete globalAssociations[previous];
            changed = true;
        }
        let managed: string | undefined;
        const existing = Object.prototype.hasOwnProperty.call(globalAssociations, pattern)
            ? globalAssociations[pattern] : undefined;
        if (existing === undefined) {
            globalAssociations[pattern] = LANGUAGE_ID;
            managed = pattern;
            changed = true;
        } else if (existing === LANGUAGE_ID && previous === pattern) {
            managed = pattern;
        }
        if (changed) {
            await files.update("associations", globalAssociations, vscode.ConfigurationTarget.Global);
        }
        await this.state.update(MANAGED_PATTERN, managed);

        const overrides = [
            existing,
            inspection.workspaceValue?.[pattern],
            ...(vscode.workspace.workspaceFolders ?? []).map(folder =>
                vscode.workspace.getConfiguration("files", folder.uri)
                    .inspect<Record<string, string>>("associations")?.workspaceFolderValue?.[pattern]
            ),
        ];
        const conflict = overrides.find(value => value !== undefined && value !== LANGUAGE_ID);
        const warning = conflict
            ? `SingleStore: The file association for "${pattern}" already points to "${conflict}". It was preserved; some matching files may not use the SingleStore language or icon.`
            : undefined;
        if (warning && warning !== this.lastWarning) {
            void vscode.window.showWarningMessage(warning);
        }
        this.lastWarning = warning;
    }

    dispose(): void {
        this.disposed = true;
    }
}
