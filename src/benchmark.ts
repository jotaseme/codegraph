import { readFileSync } from "fs";
import { CodeGraphDB } from "./storage/db.js";
import { resolve } from "path";

/**
 * Token estimation: ~4 chars per token (GPT/Claude approximation).
 * Not exact, but consistent for comparison.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface BenchmarkResult {
  scenario: string;
  symbolName: string;
  withoutCodeGraph: {
    filesRead: number;
    totalChars: number;
    estimatedTokens: number;
    description: string;
  };
  withCodeGraph: {
    totalChars: number;
    estimatedTokens: number;
    description: string;
  };
  savings: {
    tokenReduction: number;
    percentSaved: number;
  };
}

function benchmarkSymbol(db: CodeGraphDB, symbolName: string, rootDir: string): BenchmarkResult {
  const ctx = db.getContext(symbolName);
  if (!ctx.symbol) throw new Error(`Symbol "${symbolName}" not found`);

  // === WITHOUT CODEGRAPH ===
  // The agent would need to:
  // 1. Read the file containing the symbol
  // 2. Read files containing its dependencies (types, imports)
  // 3. Read files of dependents to understand usage patterns

  const filesToRead = new Set<string>();
  filesToRead.add(ctx.symbol.path);

  for (const dep of ctx.dependencies) {
    filesToRead.add(dep.path);
  }
  for (const dep of ctx.dependents) {
    filesToRead.add(dep.path);
  }

  let totalFileChars = 0;
  for (const filePath of filesToRead) {
    try {
      const content = readFileSync(filePath, "utf-8");
      totalFileChars += content.length;
    } catch {
      // file might not exist
    }
  }

  const tokensWithout = estimateTokens(totalFileChars.toString().length > 0 ? "a".repeat(totalFileChars) : "");

  // === WITH CODEGRAPH ===
  // The agent receives: symbol signature + body + dependency signatures + dependent signatures
  let codegraphOutput = "";

  // Symbol itself
  codegraphOutput += `## ${ctx.symbol.type}: ${ctx.symbol.name}\n`;
  codegraphOutput += `file: ${ctx.symbol.path}\n`;
  codegraphOutput += `signature: ${ctx.symbol.signature}\n\n`;
  codegraphOutput += `### Source\n${ctx.symbol.body}\n\n`;

  // Dependencies (only signatures, not full code)
  if (ctx.dependencies.length > 0) {
    codegraphOutput += `### Dependencies (${ctx.dependencies.length})\n`;
    for (const d of ctx.dependencies) {
      codegraphOutput += `- [${d.type}] ${d.name} — ${d.path}\n  ${d.signature}\n`;
    }
  }

  // Dependents (only signatures)
  if (ctx.dependents.length > 0) {
    codegraphOutput += `\n### Dependents (${ctx.dependents.length})\n`;
    for (const d of ctx.dependents) {
      codegraphOutput += `- [${d.type}] ${d.name} — ${d.path}\n  ${d.signature}\n`;
    }
  }

  const tokensWith = estimateTokens(codegraphOutput);
  const tokensWithoutFinal = Math.ceil(totalFileChars / 4);

  return {
    scenario: `Understand "${symbolName}" and its relationships`,
    symbolName,
    withoutCodeGraph: {
      filesRead: filesToRead.size,
      totalChars: totalFileChars,
      estimatedTokens: tokensWithoutFinal,
      description: `Read ${filesToRead.size} full files (${(totalFileChars / 1024).toFixed(1)} KB)`,
    },
    withCodeGraph: {
      totalChars: codegraphOutput.length,
      estimatedTokens: tokensWith,
      description: `Symbol body + ${ctx.dependencies.length} dep signatures + ${ctx.dependents.length} dependent signatures`,
    },
    savings: {
      tokenReduction: tokensWithoutFinal - tokensWith,
      percentSaved: Math.round((1 - tokensWith / tokensWithoutFinal) * 100),
    },
  };
}

function benchmarkSearch(db: CodeGraphDB, query: string): BenchmarkResult {
  const results = db.searchSymbols(query, 10);

  // Without CodeGraph: agent greps for the term, reads matching files
  const filesToRead = new Set<string>();
  for (const r of results) {
    filesToRead.add(r.path);
  }

  let totalFileChars = 0;
  for (const filePath of filesToRead) {
    try {
      totalFileChars += readFileSync(filePath, "utf-8").length;
    } catch {}
  }

  // With CodeGraph: just the search results
  let codegraphOutput = `Found ${results.length} symbols matching "${query}":\n\n`;
  for (const r of results) {
    codegraphOutput += `[${r.type}] ${r.name}\n  file: ${r.path}\n  signature: ${r.signature}\n\n`;
  }

  const tokensWithout = Math.ceil(totalFileChars / 4);
  const tokensWith = estimateTokens(codegraphOutput);

  return {
    scenario: `Search for "${query}"`,
    symbolName: query,
    withoutCodeGraph: {
      filesRead: filesToRead.size,
      totalChars: totalFileChars,
      estimatedTokens: tokensWithout,
      description: `Grep + read ${filesToRead.size} matching files`,
    },
    withCodeGraph: {
      totalChars: codegraphOutput.length,
      estimatedTokens: tokensWith,
      description: `${results.length} ranked results with signatures`,
    },
    savings: {
      tokenReduction: tokensWithout - tokensWith,
      percentSaved: Math.round((1 - tokensWith / tokensWithout) * 100),
    },
  };
}

function benchmarkOverview(db: CodeGraphDB, rootDir: string): BenchmarkResult {
  const overview = db.getProjectOverview();
  const allFiles = db.getAllFilePaths();

  // Without CodeGraph: agent reads key files to understand project structure
  // Typically reads: package.json, main entry points, a few lib files
  // Conservative estimate: reads ~15 files to get an overview
  const sampleFiles = allFiles.slice(0, 15);
  let totalFileChars = 0;
  for (const f of sampleFiles) {
    try {
      totalFileChars += readFileSync(f, "utf-8").length;
    } catch {}
  }

  // With CodeGraph
  let codegraphOutput = `## Project Overview\n`;
  codegraphOutput += `Files: ${overview.stats.files}\n`;
  codegraphOutput += `Symbols: ${overview.stats.symbols}\n`;
  codegraphOutput += `Exported: ${overview.stats.exported}\n`;
  codegraphOutput += `Edges: ${overview.stats.edges}\n\n`;
  codegraphOutput += `### Hub Symbols\n`;
  for (const h of overview.hubSymbols) {
    codegraphOutput += `- [${h.type}] ${h.name} — ${h.connections} connections (${h.path})\n`;
  }
  codegraphOutput += `\n### Entry Points\n`;
  for (const e of overview.entryPoints) {
    codegraphOutput += `- ${e.path} (${e.exports} exports)\n`;
  }

  const tokensWithout = Math.ceil(totalFileChars / 4);
  const tokensWith = estimateTokens(codegraphOutput);

  return {
    scenario: "Understand project structure",
    symbolName: "project_overview",
    withoutCodeGraph: {
      filesRead: sampleFiles.length,
      totalChars: totalFileChars,
      estimatedTokens: tokensWithout,
      description: `Read ~${sampleFiles.length} files to explore structure`,
    },
    withCodeGraph: {
      totalChars: codegraphOutput.length,
      estimatedTokens: tokensWith,
      description: `Stats + ${overview.hubSymbols.length} hub symbols + ${overview.entryPoints.length} entry points`,
    },
    savings: {
      tokenReduction: tokensWithout - tokensWith,
      percentSaved: Math.round((1 - tokensWith / tokensWithout) * 100),
    },
  };
}

async function main() {
  const targetDir = process.argv[2] || "/Users/jotaeme/projects/webs/mcpfast";
  const dbPath = resolve(targetDir, ".codegraph.db");
  const db = new CodeGraphDB(dbPath);

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║           CodeGraph Token Savings Benchmark                  ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
  console.log(`Target: ${targetDir}`);
  console.log(`Estimation: ~4 chars per token (Claude/GPT approximation)\n`);

  const results: BenchmarkResult[] = [];

  // Benchmark individual symbols
  const symbolsToBenchmark = [
    "getAllServers",    // widely used function
    "MCPServer",       // core type, 40 dependents
    "ServerCard",      // React component
    "computeQualityScore", // business logic
    "generateConfig",  // complex function
  ];

  for (const name of symbolsToBenchmark) {
    try {
      results.push(benchmarkSymbol(db, name, targetDir));
    } catch (e) {
      console.log(`  Skipping ${name}: ${(e as Error).message}`);
    }
  }

  // Benchmark search
  results.push(benchmarkSearch(db, "server"));
  results.push(benchmarkSearch(db, "config"));

  // Benchmark overview
  results.push(benchmarkOverview(db, targetDir));

  // Print results
  console.log(`${"─".repeat(70)}`);
  console.log(`${"Scenario".padEnd(35)} ${"Without".padStart(10)} ${"With".padStart(10)} ${"Saved".padStart(8)} ${"Reduction".padStart(10)}`);
  console.log(`${"─".repeat(70)}`);

  let totalWithout = 0;
  let totalWith = 0;

  for (const r of results) {
    const scenario = r.scenario.length > 34 ? r.scenario.slice(0, 31) + "..." : r.scenario;
    console.log(
      `${scenario.padEnd(35)} ${(r.withoutCodeGraph.estimatedTokens.toLocaleString() + " tk").padStart(10)} ${(r.withCodeGraph.estimatedTokens.toLocaleString() + " tk").padStart(10)} ${(r.savings.tokenReduction.toLocaleString() + " tk").padStart(8)} ${(r.savings.percentSaved + "%").padStart(10)}`
    );
    totalWithout += r.withoutCodeGraph.estimatedTokens;
    totalWith += r.withCodeGraph.estimatedTokens;
  }

  console.log(`${"─".repeat(70)}`);
  const totalSaved = totalWithout - totalWith;
  const totalPercent = Math.round((1 - totalWith / totalWithout) * 100);
  console.log(
    `${"TOTAL".padEnd(35)} ${(totalWithout.toLocaleString() + " tk").padStart(10)} ${(totalWith.toLocaleString() + " tk").padStart(10)} ${(totalSaved.toLocaleString() + " tk").padStart(8)} ${(totalPercent + "%").padStart(10)}`
  );

  // Detailed breakdown
  console.log(`\n${"═".repeat(70)}`);
  console.log(`DETAILED BREAKDOWN\n`);

  for (const r of results) {
    console.log(`▸ ${r.scenario}`);
    console.log(`  Without: ${r.withoutCodeGraph.description}`);
    console.log(`           ${r.withoutCodeGraph.estimatedTokens.toLocaleString()} tokens (${(r.withoutCodeGraph.totalChars / 1024).toFixed(1)} KB)`);
    console.log(`  With:    ${r.withCodeGraph.description}`);
    console.log(`           ${r.withCodeGraph.estimatedTokens.toLocaleString()} tokens (${(r.withCodeGraph.totalChars / 1024).toFixed(1)} KB)`);
    console.log(`  Saved:   ${r.savings.percentSaved}% reduction (${r.savings.tokenReduction.toLocaleString()} tokens)\n`);
  }

  // Cost estimate
  console.log(`${"═".repeat(70)}`);
  console.log(`COST ESTIMATE (Claude Sonnet pricing: $3/M input tokens)\n`);
  const costWithout = (totalWithout / 1_000_000) * 3;
  const costWith = (totalWith / 1_000_000) * 3;
  console.log(`  These ${results.length} operations without CodeGraph: $${costWithout.toFixed(4)}`);
  console.log(`  These ${results.length} operations with CodeGraph:    $${costWith.toFixed(4)}`);
  console.log(`  Savings per batch:                       $${(costWithout - costWith).toFixed(4)}`);
  console.log(`  At 100 operations/day: $${((costWithout - costWith) * (100 / results.length) * 30).toFixed(2)}/month saved\n`);

  db.close();
}

main().catch(console.error);
