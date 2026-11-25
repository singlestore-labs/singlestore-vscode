# SingleStore Language Client for VS Code

A VS Code extension that provides SQL completions for [SingleStore](https://www.singlestore.com/) using the bundled WebAssembly SingleStore Language Server.

## Prerequisites

No separate language server, Go installation, or server TCP/WebSocket endpoint is required. Version **0.2.1** of the all-grammars WASM release runs locally in a worker, using its default **10.1.0** grammar. Grammar-only completions work without a database connection.

For schema-aware completions, provide a SingleStore database connection. The extension executes metadata queries through [singlestore-nodejs](https://github.com/singlestore-labs/singlestore-nodejs); credentials remain in the extension host and are not passed into WASM. The account needs permission for the language server's `INFORMATION_SCHEMA` and `SHOW` queries. SSL uses certificate verification when enabled.

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

These settings can also be configured directly in VS Code's Settings (`Ctrl+,`) under **SingleStore connection settings**.

Host and username enable the database integration; password and database name are optional. Settings changes restart the local worker and reload metadata. The former language-server address setting is no longer used and can be removed from existing settings.

## Usage

1. Open or create a file with the `.s2db.sql` extension to use local SQL completions.
2. Configure the database using **SingleStore: Connection Configuration** to load schema-aware completions.
3. After DDL or other external schema changes, run **SingleStore: Refresh Database Schema**. There is no automatic polling. Failed refreshes are reported without disabling grammar completions or replacing the last successfully loaded schema.

## Development

Run `npm install`, `npm test`, and `npm run package`. The WASM binaries and matching Go JavaScript runtime are bundled under `wasm/`, together with the upstream license. To update them, extract `server.wasm`, `wasm_exec.js`, and `LICENSE` from the same upstream WASM release archive into that directory. Always package runtime dependencies; the SQL executor requires `singlestore-nodejs`.

## Use with SQLTools

This extension works well alongside the [SQLTools](https://marketplace.visualstudio.com/items?itemName=mtxr.sqltools) extension, which provides database management features such as browsing database objects and running queries. To connect SQLTools to a SingleStore database, install the [SingleStore Driver for SQLTools](https://marketplace.visualstudio.com/items?itemName=singlestore.sqltools-singlestore-driver).

## File Association

The extension associates with files using the `.s2db.sql` extension and provides syntax support for SingleStore SQL.

## Disclaimer

Attention: The code in this repository is intended for experimental use only and is not fully tested, documented, or supported by SingleStore. Visit the SingleStore Forums to ask questions about this repository.
