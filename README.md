# SingleStore Language Client for VS Code

A VS Code extension that provides SQL completions for [SingleStore](https://www.singlestore.com/) using the bundled WebAssembly SingleStore Language Server.

## Prerequisites

No separate language server, Go installation, or server TCP/WebSocket endpoint is required. Version **0.2.2** of the all-grammars WASM release runs locally in a worker. When connected, it detects the database version and selects a compatible bundled grammar; offline it uses the default **10.1.0** grammar. If version detection fails, it logs a warning, uses the default grammar, and retries detection during schema refresh. Grammar-only completions work without a database connection.

For schema-aware completions, provide a SingleStore database connection. The extension executes metadata queries through [singlestore-nodejs](https://github.com/singlestore-labs/singlestore-nodejs); credentials remain in the extension host and are not passed into WASM. The account needs permission for the language server's `INFORMATION_SCHEMA` and `SHOW` queries. SSL uses certificate verification when enabled.

Database connections identify the extension using the `program_name` and `program_version` connection attributes from the installed extension's package manifest.

## Installation

1. Download the `.vsix` file from the [Releases](https://github.com/singlestore-labs/singlestore-vscode/releases) page.
2. In VS Code, open the Command Palette (`Ctrl+Shift+P`) and run **Extensions: Install from VSIX…**
3. Select the downloaded `.vsix` file.

Alternatively, search for **SingleStore Language Client** on the VS Code Marketplace, in the Extensions view (`Ctrl+Shift+X`).

## Configuration

Open the configuration panel by running the command **SingleStore: Connection Configuration** from the Command Palette (`Ctrl+Shift+P`).

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `singlestore.host` | `127.0.0.1` | SingleStore database host address |
| `singlestore.port` | `3306` | SingleStore database port number |
| `singlestore.username` | | Username for database authentication |
| `singlestore.password` | | Password for database authentication |
| `singlestore.databaseName` | | Name of the database to connect to |
| `singlestore.useSSL` | `false` | Enable SSL for the database connection |
| `singlestore.filePattern` | `*.s2db.sql` | User-wide VS Code glob selecting files for SingleStore completions and language association |
| `singlestore.schemaRefreshInterval` | `5` | Automatic schema refresh interval in minutes: `1`, `5`, `30`, `60`, or `0` (never) |

These settings can also be configured directly in VS Code's Settings (`Ctrl+,`) under **SingleStore connection settings**.

Host and username enable the database integration; password and database name are optional. Database settings changes restart the local worker and reload metadata. The former language-server address setting is no longer used and can be removed from existing settings.

## Usage

1. Open or create a file matching the selected pattern to use local SQL completions.
2. Configure the database using **SingleStore: Connection Configuration** to load schema-aware completions.
3. Schema metadata refreshes automatically at the configured interval (five minutes by default) while a database connection is configured. Choose **Never** to disable periodic refresh; the initial refresh still runs. Interval changes take effect immediately without restarting the server. After DDL or other external schema changes, run **SingleStore: Refresh Database Schema** to refresh immediately. Failed refreshes are reported and retried on the next interval without disabling grammar completions or replacing the last successfully loaded schema. Repeated automatic failures are logged in the extension host log; a notification appears on the first failure until a refresh succeeds.

## Semantic highlighting

The local server provides semantic highlighting for files matching the selected pattern. The connection configuration panel offers colors for each server token type. Enter a `#RGB` or `#RRGGBB` color or use the color picker; leave a field blank to use the theme's color. Color overrides are saved in the user-level `editor.semanticTokenColorCustomizations` under SingleStore-specific token names and do not change unrelated rules. Theme-specific or workspace settings may override them.

Semantic highlighting is enabled by default for the SingleStore SQL language, unless explicitly disabled in VS Code settings. Files whose existing language association is preserved use that language's semantic-highlighting setting instead.

The 0.2.2 server can report incorrect token positions after unquoted non-ASCII characters it does not recognize. Quoted Unicode strings and comments are supported.

## Development

Run `npm install`, `npm test`, and `npm run package`. The WASM binaries and matching Go JavaScript runtime are bundled under `wasm/`, together with the upstream license. To update them, extract `server.wasm`, `wasm_exec.js`, and `LICENSE` from the same upstream WASM release archive into that directory. Always package runtime dependencies; the SQL executor requires `singlestore-nodejs`.

## Use with SQLTools

This extension works well alongside the [SQLTools](https://marketplace.visualstudio.com/items?itemName=mtxr.sqltools) extension, which provides database management features such as browsing database objects and running queries. To connect SQLTools to a SingleStore database, install the [SingleStore Driver for SQLTools](https://marketplace.visualstudio.com/items?itemName=singlestore.sqltools-singlestore-driver).

## File Association

Select `*.s2db.sql`, `*.sql`, or a custom [VS Code glob](https://code.visualstudio.com/docs/editor/glob-patterns) in the connection panel, or set `singlestore.filePattern` in user settings. The selected pattern replaces the previous one; it does not add to it. Filename-only patterns match at any depth; patterns with `/` match the full path (for example `**/queries/*.sql`). Use `/` as the separator even on Windows.

The extension adds the selected pattern to user `files.associations` as `singlestore-sql` so unopened files can use the language's icon. It removes its previously managed entry when the pattern changes, but never replaces or removes pre-existing entries. If an exact association conflicts, it warns and leaves that association unchanged; other more specific associations can also take precedence. Completion matching is independent of the language association.

The displayed icon is controlled by the active file icon theme. Themes may override language icons with their own file or extension icons, or disable language icons entirely. Selecting `*.sql` changes the language mode of matching files and can affect other SQL extensions. Language association changes persist in user settings; remove the `files.associations` entry manually after uninstalling the extension if desired.

## Disclaimer

Attention: The code in this repository is intended for experimental use only and is not fully tested, documented, or supported by SingleStore. Visit the SingleStore Forums to ask questions about this repository.
