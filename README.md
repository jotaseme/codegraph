# CodeGraph

Context engine for AI coding agents. Parses your codebase with tree-sitter, builds a dependency graph, and serves structured context via MCP.

**Result:** Your AI agent gets pre-analyzed context instead of reading raw files. ~91% fewer tokens for understanding code relationships.

## How it works

```
Your codebase
    │
    ▼
[1. INDEX]    tree-sitter parses every file
    │          extracts: functions, classes, imports, exports, types
    ▼
[2. GRAPH]    resolves imports between files
    │          builds graph: node = symbol, edge = "uses/imports"
    ▼
[3. STORE]    SQLite + FTS5 full-text search (.codegraph.db)
    ▼
[4. SERVE]    MCP server (stdio) or web dashboard
    │
    ▼
Claude Code / Cursor / Windsurf
    receives only the relevant context, not entire files
```

## Quick start

```bash
# Index your project
npx codegraph index .

# Start MCP server (for AI agents)
npx codegraph serve .

# Start web dashboard (for humans)
npx codegraph dashboard .

# Query a symbol
npx codegraph query getAllServers
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `search` | Full-text search for symbols (functions, classes, types) |
| `get_context` | Get a symbol with its dependencies and dependents |
| `get_file_deps` | Get all imports and exports for a file |
| `project_overview` | High-level stats: hub nodes, entry points, connections |

### Claude Code integration

Add to your MCP config:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["codegraph", "serve", "/path/to/your/project"]
    }
  }
}
```

## Dashboard

Run `codegraph dashboard` to open an interactive visualization:

- Force-directed graph of your codebase
- Click nodes to see dependencies and dependents
- Search symbols with full-text search
- Filter by type (functions, types, files)
- Dark theme

## Performance

Tested on a real Next.js project (82 files, 384 symbols):

| Step | Time |
|------|------|
| Walk files | 12ms |
| Parse all | 97ms |
| Store + graph | 54ms |
| **Total** | **163ms** |

DB size: ~560 KB.

## Supported languages

- TypeScript (.ts, .tsx)
- JavaScript (.js, .jsx)

## Stack

- **tree-sitter** (WASM) — parsing
- **better-sqlite3** — storage + FTS5
- **@modelcontextprotocol/sdk** — MCP server
- **d3-force** — graph visualization

## License

MIT
