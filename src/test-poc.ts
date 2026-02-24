import { parseFile } from "./indexer/parser.js";
import { walkDirectory } from "./indexer/walker.js";
import { CodeGraphDB } from "./storage/db.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";

const MCPFAST_DIR = "/Users/jotaeme/projects/webs/mcpfast";
const DB_PATH = join(process.cwd(), ".codegraph-test.db");

async function main() {
  // Clean previous test DB
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

  console.log(`\n=== CodeGraph PoC — End to End ===\n`);
  console.log(`Target: ${MCPFAST_DIR}`);
  console.log(`DB: ${DB_PATH}\n`);

  // Step 1: Walk
  const walkStart = performance.now();
  const files = await walkDirectory({ rootDir: MCPFAST_DIR });
  console.log(`1. Walk: ${files.length} files in ${(performance.now() - walkStart).toFixed(0)}ms`);

  // Step 2: Parse all
  const parseStart = performance.now();
  const parsedFiles = [];
  let errors = 0;

  for (const file of files) {
    try {
      const result = await parseFile(file);
      parsedFiles.push(result);
    } catch (e) {
      errors++;
      console.log(`   ERROR: ${file}: ${(e as Error).message}`);
    }
  }
  console.log(`2. Parse: ${parsedFiles.length} files in ${(performance.now() - parseStart).toFixed(0)}ms (${errors} errors)`);

  // Step 3: Save to SQLite
  const dbStart = performance.now();
  const db = new CodeGraphDB(DB_PATH);
  db.insertBatch(parsedFiles);
  console.log(`3. Save: SQLite in ${(performance.now() - dbStart).toFixed(0)}ms`);

  // Step 4: Query stats
  const stats = db.getStats();
  console.log(`\n--- STATS ---`);
  console.log(`  Files:    ${stats.files}`);
  console.log(`  Symbols:  ${stats.symbols}`);
  console.log(`  Imports:  ${stats.imports}`);
  console.log(`  Exported: ${stats.exported}`);

  // Step 5: Query exported functions
  const exported = db.getExportedFunctions();
  console.log(`\n--- EXPORTED FUNCTIONS (${exported.length}) ---`);
  for (const fn of exported.slice(0, 15)) {
    console.log(`  ${fn.path.replace(MCPFAST_DIR + "/", "")}`);
    console.log(`    ${fn.signature}`);
  }
  if (exported.length > 15) {
    console.log(`  ... and ${exported.length - 15} more`);
  }

  // Step 6: FTS search
  console.log(`\n--- FTS SEARCH: "server" ---`);
  const results = db.searchSymbols("server", 10);
  for (const r of results) {
    console.log(`  [${r.type}] ${r.name} — ${r.path.replace(MCPFAST_DIR + "/", "")}`);
    console.log(`    ${r.signature}`);
  }

  // Step 7: Specific symbol lookup
  console.log(`\n--- SYMBOL LOOKUP: "getAllServers" ---`);
  const symbols = db.getSymbol("getAllServers");
  for (const s of symbols) {
    console.log(`  [${s.type}] ${s.name} (${s.path.replace(MCPFAST_DIR + "/", "")}:${s.startLine}-${s.endLine})`);
    console.log(`    signature: ${s.signature}`);
    console.log(`    exported: ${s.exported}`);
  }

  db.close();

  // DB file size
  const { statSync } = await import("fs");
  const dbStat = statSync(DB_PATH);
  console.log(`\nDB size: ${(dbStat.size / 1024).toFixed(1)} KB`);

  console.log(`\n=== PoC Complete ===`);
}

main().catch(console.error);
