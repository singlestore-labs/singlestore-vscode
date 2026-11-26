# SingleStore Language Client for VS Code

A VS Code extension that provides SQL completions for [SingleStore](https://www.singlestore.com/) using the bundled WebAssembly SingleStore Language Server. A SingleStore icon in the Activity Bar opens the connection manager.

## Prerequisites

No separate language server, Go installation, or server TCP/WebSocket endpoint is required. Version **0.2.2** of the all-grammars WASM release runs locally in a worker. When connected, it detects the database version and selects a compatible bundled grammar; offline it uses the default **10.1.0** grammar. If version detection fails, it logs a warning, uses the default grammar, and retries detection during schema refresh. Grammar-only completions work without a database connection.

For schema-aware completions, add and connect to a SingleStore profile in the Activity Bar's **Connections** view. The extension executes metadata queries through [singlestore-nodejs](https://github.com/singlestore-labs/singlestore-nodejs); passwords are stored in VS Code SecretStorage and are not passed into WASM. The account needs permission for the language server's `INFORMATION_SCHEMA` and `SHOW` queries. SSL uses certificate verification when enabled. Only one profile can be active at a time.

Database connections identify the extension using the `program_name` and `program_version` connection attributes from the installed extension's package manifest.

## Installation

1. Download the `.vsix` file from the [Releases](https://github.com/singlestore-labs/singlestore-vscode/releases) page.
2. In VS Code, open the Command Palette (`Ctrl+Shift+P`) and run **Extensions: Install from VSIX…**
3. Select the downloaded `.vsix` file.

Alternatively, search for **SingleStore Language Client** on the VS Code Marketplace, in the Extensions view (`Ctrl+Shift+X`).

## Configuration

Use the **SingleStore** icon in the Activity Bar to add, connect, edit, or delete database profiles. Add and edit open a dedicated connection form with all profile fields; use **Test connection** in the form to check whether the entered parameters can connect without saving them (when editing, a blank password tests with the saved password unless **Remove saved password** is checked). Right-click a profile for its actions. Click an inactive profile to connect or the active profile to disconnect. Use **SingleStore: Preferences** for semantic colors and other SQL editor preferences.

The Connections toolbar provides icon buttons for **Add Connection**, **Preferences**, and **Refresh Database Schema**. Hover over a connection to access **Connect/Disconnect**, **Edit Connection**, and **Delete Connection** icons. Hover over any button to see its action name.

### Preferences

| Setting | Default | Description |
|---------|---------|-------------|
| `singlestore.filePattern` | `*.s2db.sql` | User-wide VS Code glob selecting files for SingleStore completions and language association |
| `singlestore.schemaRefreshInterval` | `5` | Automatic schema refresh interval in minutes: `1`, `5`, `30`, `60`, or `0` (never) |
| `singlestore.queryRowLimit` | `200` | Maximum result rows retained and displayed per result set |

These preferences can be configured in **SingleStore: Preferences** or VS Code Settings (`Ctrl+,`). When upgrading, existing global connection settings are migrated once into a profile named **Migrated connection**; its password is moved to SecretStorage and the old settings are removed.

## Usage

1. Open or create a file matching the selected pattern to use local SQL completions.
2. Add and connect to a profile in the SingleStore Activity Bar view to load schema-aware completions.
3. Schema metadata refreshes automatically at the configured interval (five minutes by default) while a database connection is configured. Choose **Never** to disable periodic refresh; the initial refresh still runs. Interval changes take effect immediately without restarting the server. After DDL or other external schema changes, run **SingleStore: Refresh Database Schema** to refresh immediately. Failed refreshes are reported and retried on the next interval without disabling grammar completions or replacing the last successfully loaded schema. Repeated automatic failures are logged in the extension host log; a notification appears on the first failure until a refresh succeeds.

## Running queries

Connect a profile and press **Ctrl+Enter** (**Cmd+Enter** on macOS) in a SQL editor, use the play button, or run **SingleStore: Execute Selection or Current Query**. If text is selected, it runs the selection; otherwise it runs the statement at the cursor. Separate commands are also available for **Execute Selected SQL** and **Execute Query at Cursor**. Statements are separated by `;` by default; MySQL-style `DELIMITER` directives on their own line change the delimiter. Delimiters in quoted strings, identifiers, and comments are ignored. Select complete statements when running a selection. The splitter assumes standard backslash escaping in quoted values; scripts that change `NO_BACKSLASH_ESCAPES` require special care.

Selected statements run sequentially in the same SQL session and stop on the first error. A new results tab displays each result set or affected-row count, including errors. Query History in the SingleStore sidebar records each attempted statement, including failures, for the current VS Code session only. Click an entry to execute it on the **currently active** profile; its original connection is shown for reference. Clear the history using its toolbar button. Queries may contain sensitive literals.

The row limit applies to each result set and can be changed in **SingleStore: Preferences** or VS Code Settings. Extra rows are streamed and discarded rather than retained, but the server still sends them. The SQL execution session is separate from the language server's metadata connections and persists across query runs until disconnecting, switching or editing the active profile, a connection failure, or extension shutdown. Session variables, temporary tables, and transactions therefore do not carry across those events; commit or roll back transactions explicitly.

## Object explorer

Expand the active connection using its disclosure arrow in the **Connections** view. The tree reuses the language server's metadata queries; expanding objects does not execute additional queries or start a separate refresh timer.

Databases contain tables, views, temporary tables, columns and indexes, pipelines, links, aggregates, extensions, functions and procedures with parameters, projections, and result tables. Connection-level categories include groups, users, roles, resource pools, hosts, character sets, collations, and variable names. Variable values are not displayed. Categories depend on metadata returned by the server and the account's permissions. Table groups are not available because the bundled language server does not query them.

The tree updates only after a successful initial, automatic, or manual schema refresh. Failed refreshes preserve the last successful tree; disconnecting, changing the active profile, or editing its connection details clears it. Until the first successful refresh, the active connection displays **Schema not loaded**.

## Semantic highlighting

The local server provides semantic highlighting for files matching the selected pattern. **SingleStore: Preferences** offers colors for each server token type. Enter a `#RGB` or `#RRGGBB` color or use the color picker; leave a field blank to use the theme's color. Color overrides are saved in the user-level `editor.semanticTokenColorCustomizations` under SingleStore-specific token names and do not change unrelated rules. Theme-specific or workspace settings may override them.

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
