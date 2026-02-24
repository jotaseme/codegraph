# CodeGraph: Getting Started

A step-by-step guide. No prior knowledge of MCP or token economics required.

---

## The problem CodeGraph solves

When you use an AI coding assistant (Claude Code, Cursor, Windsurf, etc.), every time you ask it to understand your code, it reads your files. All of them. The full content.

**Example:** You ask "what does `getAllServers` do and who uses it?"

Your AI assistant will:
1. Read `data.ts` (the file with `getAllServers`) — 82 lines
2. Read `types.ts` (to understand `MCPServer` type) — 95 lines
3. Read the 15 files that import `getAllServers` — ~1,500 lines total
4. **Total: ~1,700 lines sent to the AI model**

That's ~19,000 tokens. Every time.

**With CodeGraph**, the same question returns:
1. The function signature + body — 6 lines
2. The type signature (not full file) — 1 line
3. A list of 15 dependents as one-line signatures — 15 lines
4. **Total: ~22 lines sent to the AI model**

That's ~637 tokens. **97% less.**

### Why does this matter?

1. **Cost**: AI APIs charge per token. Less tokens = less money.
2. **Speed**: Fewer tokens = faster responses.
3. **Context window**: AI models have a limit (e.g., 200K tokens). If your codebase burns 50K tokens on context, that's 25% of your window gone before the AI even starts thinking.
4. **Accuracy**: Less noise = the AI focuses on what matters, not on irrelevant code in the same files.

---

## How CodeGraph works (30-second version)

```
Step 1: You run "codegraph index" on your project
        → It parses every file, extracts functions/classes/types,
          and builds a map of "who imports what"
        → Saves everything in a tiny SQLite file (.codegraph.db)

Step 2: Your AI assistant connects to CodeGraph via MCP
        → Instead of reading files, it calls CodeGraph tools
        → Gets exactly the context it needs, nothing more

That's it.
```

**MCP** (Model Context Protocol) is just a standard way for AI assistants to call external tools. Think of it like a USB port — any device (AI assistant) can plug into any tool (CodeGraph) as long as they speak the same protocol.

---

## Setup (5 minutes)

### Step 1: Index your project

Open your terminal in your project directory and run:

```bash
npx codegraph index .
```

You'll see something like:

```
codegraph index
  target: /Users/you/my-project
  db:     /Users/you/my-project/.codegraph.db

  [1/3] Found 82 files (12ms)
  [2/3] Parsed 82 files, 384 symbols (97ms)
  [3/3] Stored + graph: 300 edges (54ms)

  Done! Stats:
    Files:    82
    Symbols:  384
    Exported: 155
    Edges:    300
```

That's your entire codebase indexed in under 200ms. A `.codegraph.db` file appears in your project root (add it to `.gitignore`).

### Step 2: Connect your AI assistant

Pick your editor:

**Claude Code** — Edit `~/.claude.json` or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["codegraph", "serve", "/absolute/path/to/your/project"]
    }
  }
}
```

**Cursor** — Edit `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["codegraph", "serve", "/absolute/path/to/your/project"]
    }
  }
}
```

**Windsurf** — Add to your MCP settings:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["codegraph", "serve", "/absolute/path/to/your/project"]
    }
  }
}
```

> **Important:** Use the absolute path to your project (e.g., `/Users/you/my-project`, not `.` or `./`).

### Step 3: There is no step 3

Your AI assistant now has 4 new tools available. It will use them automatically when it makes sense. You don't need to do anything differently — just code as usual.

---

## What your AI assistant can now do

### Tool 1: `search` — Find symbols fast

Instead of grepping through files, your AI calls:

```
search("server")
```

And gets a ranked list:

```
[function] ServerCard — src/components/servers/server-card.tsx
  function ServerCard({ server }: ServerCardProps)

[function] computeQualityScore — src/lib/quality-score.ts
  function computeQualityScore(server: MCPServer): QualityBreakdown

[interface] MCPServer — src/lib/types.ts
  interface MCPServer
```

No files opened. No irrelevant code. Just the matches, ranked by relevance.

### Tool 2: `get_context` — Understand a symbol deeply

Your AI calls:

```
get_context("getAllServers")
```

And gets:

```
## function: getAllServers
file: src/lib/data.ts
signature: function getAllServers(): MCPServer[]

### Source
function getAllServers(): MCPServer[] {
  const files = fs.readdirSync(SERVERS_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => JSON.parse(fs.readFileSync(path.join(SERVERS_DIR, f), "utf-8")))
    .sort((a, b) => b.githubStars - a.githubStars);
}

### Dependencies (1)
- [interface] MCPServer — src/lib/types.ts
  interface MCPServer

### Dependents (15)
- [function] GET — src/app/api/server-metrics/route.ts
- [function] Home — src/app/page.tsx
- [function] ServersPage — src/app/servers/page.tsx
- ... (12 more)
```

The AI gets the full function code, what it depends on (as signatures), and who uses it (as signatures). One call instead of reading 17 files.

### Tool 3: `get_file_deps` — Understand a file's connections

```
get_file_deps("src/lib/data.ts")
```

Returns all imports and exports for that file. Useful for the AI to understand the role of a file without reading it.

### Tool 4: `project_overview` — Understand the whole codebase

```
project_overview()
```

Returns:
- How many files, symbols, and connections
- The most important symbols (most connected)
- Entry points (pages, routes, layouts)

Your AI gets a mental map of your project in one call.

---

## The dashboard (bonus)

Want to see your codebase visually? Run:

```bash
npx codegraph dashboard .
```

Open `http://localhost:3000` in your browser. You'll see:

- **Interactive graph**: your files and symbols as nodes, imports as edges
- **Search**: type a name and see results instantly
- **Symbol detail**: click any node to see its code, dependencies, and dependents
- **Filters**: show only functions, types, or files

This is for you, the developer. The MCP server is for your AI assistant.

---

## Running the benchmark

Want to see exactly how many tokens CodeGraph saves for your project?

```bash
# First, index your project
npx codegraph index .

# Then run the benchmark
npx tsx node_modules/codegraph/src/benchmark.ts .
```

Or if you cloned the repo:

```bash
npx tsx src/benchmark.ts /path/to/your/project
```

You'll get a table showing token counts with and without CodeGraph for different scenarios, plus a cost estimate.

---

## FAQ

**Q: Do I need to re-index after changing files?**
A: Yes, run `codegraph index .` again. It takes <200ms for most projects. A file watcher for automatic re-indexing is coming soon.

**Q: Does it work with monorepos?**
A: Not yet. Currently works best with single-package projects. Monorepo support is planned.

**Q: What languages are supported?**
A: TypeScript and JavaScript (.ts, .tsx, .js, .jsx). More languages coming.

**Q: Does it read my node_modules?**
A: No. It skips `node_modules`, `.git`, `dist`, `build`, and other common directories automatically.

**Q: How big is the .codegraph.db file?**
A: Typically under 1 MB. For an 82-file project: ~560 KB.

**Q: Is my code sent anywhere?**
A: No. Everything runs locally. The SQLite database is a local file. The MCP server communicates only with your local AI assistant via stdio.

**Q: Can I use this with multiple projects?**
A: Yes. Each project gets its own `.codegraph.db`. Configure one MCP server per project, or switch the path.

---

## Troubleshooting

**"No index found"** — Run `codegraph index .` in your project directory first.

**"Port already in use"** — The dashboard defaults to port 3000. Use `--port=4000` to pick another.

**MCP server not connecting** — Make sure the path in your MCP config is absolute (starts with `/`), not relative.

**No symbols found** — Check that your project has `.ts`, `.tsx`, `.js`, or `.jsx` files in the `src/` directory (or wherever your source code lives).
