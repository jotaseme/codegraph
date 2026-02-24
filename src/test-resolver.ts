import { resolveImport, loadTsConfigPaths } from "./indexer/resolver.js";
import { parseFile } from "./indexer/parser.js";
import { walkDirectory } from "./indexer/walker.js";

const MCPFAST_DIR = "/Users/jotaeme/projects/webs/mcpfast";

async function main() {
  const tsConfig = loadTsConfigPaths(MCPFAST_DIR);
  console.log("tsconfig paths:", tsConfig.paths);
  console.log();

  const files = await walkDirectory({ rootDir: MCPFAST_DIR });

  let totalImports = 0;
  let resolved = 0;
  let unresolved = 0;
  let bare = 0;
  const unresolvedList: { from: string; source: string }[] = [];

  for (const file of files) {
    const parsed = await parseFile(file);
    for (const imp of parsed.imports) {
      totalImports++;
      const target = resolveImport(imp.source, file, MCPFAST_DIR, tsConfig);
      if (target) {
        resolved++;
      } else if (imp.source.startsWith(".") || imp.source.startsWith("@/")) {
        unresolved++;
        unresolvedList.push({
          from: file.replace(MCPFAST_DIR + "/", ""),
          source: imp.source,
        });
      } else {
        bare++; // node_modules — expected
      }
    }
  }

  console.log(`Total imports: ${totalImports}`);
  console.log(`Resolved:      ${resolved} (local files)`);
  console.log(`Bare/external: ${bare} (node_modules — skipped)`);
  console.log(`Unresolved:    ${unresolved}`);

  if (unresolvedList.length > 0) {
    console.log("\nUnresolved local imports:");
    for (const u of unresolvedList) {
      console.log(`  ${u.from} → ${u.source}`);
    }
  }
}

main().catch(console.error);
