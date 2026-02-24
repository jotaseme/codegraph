import { parseFile } from "./indexer/parser.js";
import { walkDirectory } from "./indexer/walker.js";
import { buildGraph } from "./indexer/graph.js";
import { CodeGraphDB } from "./storage/db.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";

const MCPFAST_DIR = "/Users/jotaeme/projects/webs/mcpfast";
const DB_PATH = join(process.cwd(), ".codegraph-test.db");

async function main() {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

  console.log(`\n=== CodeGraph — Graph Test ===\n`);

  // Walk + Parse
  const files = await walkDirectory({ rootDir: MCPFAST_DIR });
  const parsedFiles = [];
  for (const file of files) {
    try {
      parsedFiles.push(await parseFile(file));
    } catch {}
  }

  // Store in DB
  const db = new CodeGraphDB(DB_PATH);
  db.insertBatch(parsedFiles);

  // Build graph
  const start = performance.now();
  const graphStats = buildGraph(parsedFiles, MCPFAST_DIR, db);
  const elapsed = (performance.now() - start).toFixed(0);

  console.log(`Graph built in ${elapsed}ms`);
  console.log(`  Edges created: ${graphStats.edgesCreated}`);
  console.log(`  Imports resolved: ${graphStats.importsResolved}`);
  console.log(`  Imports unresolved (bare): ${graphStats.importsUnresolved}`);

  // Test: context for getAllServers
  console.log(`\n--- CONTEXT: getAllServers ---`);
  const ctx = db.getContext("getAllServers");
  if (ctx.symbol) {
    console.log(`  Symbol: ${ctx.symbol.signature}`);
    console.log(`  File: ${ctx.symbol.path.replace(MCPFAST_DIR + "/", "")}`);
    console.log(`  Dependencies (${ctx.dependencies.length}):`);
    for (const d of ctx.dependencies) {
      console.log(`    → ${d.name} (${d.type}) — ${d.path.replace(MCPFAST_DIR + "/", "")}`);
    }
    console.log(`  Dependents (${ctx.dependents.length}):`);
    for (const d of ctx.dependents) {
      console.log(`    ← ${d.name} (${d.type}) — ${d.path.replace(MCPFAST_DIR + "/", "")}`);
    }
  }

  // Test: context for MCPServer (type)
  console.log(`\n--- CONTEXT: MCPServer ---`);
  const ctx2 = db.getContext("MCPServer");
  if (ctx2.symbol) {
    console.log(`  Symbol: ${ctx2.symbol.signature}`);
    console.log(`  Dependents (${ctx2.dependents.length}):`);
    for (const d of ctx2.dependents.slice(0, 10)) {
      console.log(`    ← ${d.name} (${d.type}) — ${d.path.replace(MCPFAST_DIR + "/", "")}`);
    }
    if (ctx2.dependents.length > 10) {
      console.log(`    ... and ${ctx2.dependents.length - 10} more`);
    }
  }

  // Test: project overview
  console.log(`\n--- PROJECT OVERVIEW ---`);
  const overview = db.getProjectOverview();
  console.log(`  Stats: ${JSON.stringify(overview.stats)}`);
  console.log(`  Hub symbols (top 5):`);
  for (const h of overview.hubSymbols.slice(0, 5)) {
    console.log(`    ${h.name} (${h.type}) — ${h.connections} connections`);
  }
  console.log(`  Entry points: ${overview.entryPoints.length}`);

  db.close();
  console.log(`\n=== Graph Test Complete ===`);
}

main().catch(console.error);
