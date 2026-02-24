#!/usr/bin/env node
/**
 * Pre-generate all API data as static JSON files for Vercel deployment.
 * Usage: npx tsx src/static-export.ts [dir]
 */
import { resolve, join } from "path";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { CodeGraphDB } from "./storage/db.js";

const DB_FILENAME = ".codegraph.db";

function main() {
  const targetDir = resolve(process.argv[2] || ".");
  const dbPath = join(targetDir, DB_FILENAME);
  const outDir = join(targetDir, "public", "api");

  if (!existsSync(dbPath)) {
    console.error(`No index found at ${dbPath}. Run "codegraph index" first.`);
    process.exit(1);
  }

  const db = new CodeGraphDB(dbPath);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "symbol"), { recursive: true });

  // /api/stats
  const overview = db.getProjectOverview();
  writeJSON(join(outDir, "stats.json"), overview);
  console.log(`  stats.json`);

  // /api/graph
  const nodes = db.getGraphNodes();
  const edges = db.getGraphEdges();
  writeJSON(join(outDir, "graph.json"), { nodes, edges });
  console.log(`  graph.json`);

  // /api/benchmark
  const benchmark = db.getTokenSavings();
  writeJSON(join(outDir, "benchmark.json"), benchmark);
  console.log(`  benchmark.json`);

  // /api/files
  const files = db.getAllFilePaths();
  writeJSON(join(outDir, "files.json"), files);
  console.log(`  files.json`);

  // /api/symbol/:name — pre-generate for all symbols with edges
  const hubSymbols = overview.hubSymbols;
  for (const hub of hubSymbols) {
    const ctx = db.getContext(hub.name);
    writeJSON(join(outDir, "symbol", `${hub.name}.json`), ctx);
    console.log(`  symbol/${hub.name}.json`);
  }

  // Also export top search results for common terms
  const searchTerms = ["function", "class", "interface", "type"];
  mkdirSync(join(outDir, "search"), { recursive: true });
  for (const term of searchTerms) {
    const results = db.searchSymbols(term, 20);
    writeJSON(join(outDir, "search", `${term}.json`), results);
    console.log(`  search/${term}.json`);
  }

  db.close();
  console.log(`\nDone! Static API files in: ${outDir}`);
}

function writeJSON(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data));
}

main();
