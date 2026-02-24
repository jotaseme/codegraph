#!/usr/bin/env node

import { resolve, join } from "path";
import { existsSync } from "fs";
import { parseFile } from "./indexer/parser.js";
import { walkDirectory } from "./indexer/walker.js";
import { buildGraph } from "./indexer/graph.js";
import { CodeGraphDB } from "./storage/db.js";
import { startMcpServer } from "./server/mcp.js";
import { startWebServer } from "./server/web.js";
import { startWatcher } from "./indexer/watcher.js";

const DB_FILENAME = ".codegraph.db";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "index") {
    await indexCommand(args.slice(1));
  } else if (command === "serve") {
    await serveCommand(args.slice(1));
  } else if (command === "dashboard") {
    await dashboardCommand(args.slice(1));
  } else if (command === "query") {
    await queryCommand(args.slice(1));
  } else if (command === "watch") {
    await watchCommand(args.slice(1));
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
codegraph — Context engine for AI coding agents

Commands:
  index [dir]     Index a project directory (default: current dir)
  serve [dir]     Start MCP server on stdio (default: current dir)
  dashboard [dir] Start web dashboard on http://localhost:3000
  query <name>    Query a symbol from the index
  watch [dir]     Watch for changes and re-index automatically

Options:
  --watch         Auto re-index on file changes (for serve/dashboard)
  --help, -h      Show this help
`);
}

async function indexCommand(args: string[]) {
  const targetDir = resolve(args[0] || ".");
  const dbPath = join(targetDir, DB_FILENAME);

  console.log(`\ncodegraph index`);
  console.log(`  target: ${targetDir}`);
  console.log(`  db:     ${dbPath}\n`);

  // Step 1: Walk
  const walkStart = performance.now();
  const files = await walkDirectory({ rootDir: targetDir });
  console.log(`  [1/3] Found ${files.length} files (${ms(walkStart)})`);

  // Step 2: Parse
  const parseStart = performance.now();
  const parsedFiles = [];
  let errors = 0;

  for (const file of files) {
    try {
      parsedFiles.push(await parseFile(file));
    } catch {
      errors++;
    }
  }

  let totalSymbols = 0;
  for (const f of parsedFiles) totalSymbols += f.symbols.length;
  console.log(
    `  [2/3] Parsed ${parsedFiles.length} files, ${totalSymbols} symbols (${ms(parseStart)})${
      errors > 0 ? ` (${errors} errors)` : ""
    }`
  );

  // Step 3: Store + graph
  const storeStart = performance.now();
  const db = new CodeGraphDB(dbPath);
  db.insertBatch(parsedFiles);
  const graphStats = buildGraph(parsedFiles, targetDir, db);
  const stats = db.getProjectOverview();
  db.close();

  console.log(
    `  [3/3] Stored + graph: ${graphStats.edgesCreated} edges (${ms(storeStart)})`
  );

  console.log(`\n  Done! Stats:`);
  console.log(`    Files:    ${stats.stats.files}`);
  console.log(`    Symbols:  ${stats.stats.symbols}`);
  console.log(`    Exported: ${stats.stats.exported}`);
  console.log(`    Edges:    ${stats.stats.edges}`);
  console.log(`\n  DB saved to: ${dbPath}\n`);
}

async function serveCommand(args: string[]) {
  const targetDir = resolve(args.find((a) => !a.startsWith("--")) || ".");
  const dbPath = join(targetDir, DB_FILENAME);
  const shouldWatch = args.includes("--watch");

  if (!existsSync(dbPath)) {
    console.error(
      `No index found at ${dbPath}. Run "codegraph index ${targetDir}" first.`
    );
    process.exit(1);
  }

  // Stderr so it doesn't interfere with MCP stdio protocol
  console.error(`codegraph serve — MCP server starting`);
  console.error(`  db: ${dbPath}`);

  if (shouldWatch) {
    console.error(`  watch: enabled (auto re-index on changes)`);
    startWatcher({
      rootDir: targetDir,
      dbPath,
      onReindex: (stats) => {
        console.error(`  [watch] re-indexed: ${stats.files} files, ${stats.symbols} symbols, ${stats.edges} edges (${stats.timeMs}ms)`);
      },
    });
  }

  await startMcpServer(dbPath);
}

async function dashboardCommand(args: string[]) {
  const targetDir = resolve(args.find((a) => !a.startsWith("--")) || ".");
  const dbPath = join(targetDir, DB_FILENAME);
  const shouldWatch = args.includes("--watch");

  if (!existsSync(dbPath)) {
    console.error(
      `No index found at ${dbPath}. Run "codegraph index ${targetDir}" first.`
    );
    process.exit(1);
  }

  const port = parseInt(args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "3000");

  console.log(`codegraph dashboard`);
  console.log(`  db: ${dbPath}`);
  startWebServer(dbPath, port);

  if (shouldWatch) {
    console.log(`  watch: enabled (auto re-index on changes)`);
    startWatcher({
      rootDir: targetDir,
      dbPath,
      onReindex: (stats) => {
        console.log(`  [watch] re-indexed: ${stats.files} files, ${stats.symbols} symbols, ${stats.edges} edges (${stats.timeMs}ms)`);
      },
    });
  }
}

async function queryCommand(args: string[]) {
  const name = args[0];
  if (!name) {
    console.error("Usage: codegraph query <symbol-name>");
    process.exit(1);
  }

  // Find the DB in current directory or parent
  const dbPath = findDb(".");
  if (!dbPath) {
    console.error("No .codegraph.db found. Run 'codegraph index' first.");
    process.exit(1);
  }

  const db = new CodeGraphDB(dbPath);
  const ctx = db.getContext(name);

  if (!ctx.symbol) {
    // Try FTS search
    const results = db.searchSymbols(name, 5);
    if (results.length > 0) {
      console.log(`Symbol "${name}" not found. Did you mean:\n`);
      for (const r of results) {
        console.log(`  [${r.type}] ${r.name} — ${r.path}`);
      }
    } else {
      console.log(`Symbol "${name}" not found.`);
    }
    db.close();
    return;
  }

  console.log(`\n${ctx.symbol.type}: ${ctx.symbol.name}`);
  console.log(`file: ${ctx.symbol.path}`);
  console.log(`exported: ${ctx.symbol.exported}`);
  console.log(`signature: ${ctx.symbol.signature}`);
  console.log(`\n--- Source ---\n${ctx.symbol.body}`);

  if (ctx.dependencies.length > 0) {
    console.log(`\n--- Dependencies (${ctx.dependencies.length}) ---`);
    for (const d of ctx.dependencies) {
      console.log(`  → [${d.type}] ${d.name} — ${d.path}`);
    }
  }

  if (ctx.dependents.length > 0) {
    console.log(`\n--- Dependents (${ctx.dependents.length}) ---`);
    for (const d of ctx.dependents) {
      console.log(`  ← [${d.type}] ${d.name} — ${d.path}`);
    }
  }

  db.close();
}

async function watchCommand(args: string[]) {
  const targetDir = resolve(args[0] || ".");
  const dbPath = join(targetDir, DB_FILENAME);

  // Index first if no DB exists
  if (!existsSync(dbPath)) {
    console.log(`  No index found. Running initial index...`);
    await indexCommand(args);
  }

  console.log(`\ncodegraph watch`);
  console.log(`  target: ${targetDir}`);
  console.log(`  db:     ${dbPath}`);
  console.log(`  Watching for changes... (Ctrl+C to stop)\n`);

  startWatcher({
    rootDir: targetDir,
    dbPath,
    onReindex: (stats) => {
      const time = new Date().toLocaleTimeString();
      console.log(`  [${time}] re-indexed: ${stats.files} files, ${stats.symbols} symbols, ${stats.edges} edges (${stats.timeMs}ms)`);
    },
  });
}

function findDb(startDir: string): string | null {
  let dir = resolve(startDir);
  while (dir !== "/") {
    const candidate = join(dir, DB_FILENAME);
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  return null;
}

function ms(start: number): string {
  return `${(performance.now() - start).toFixed(0)}ms`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
