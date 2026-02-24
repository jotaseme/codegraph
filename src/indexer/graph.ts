import type { ParsedFile } from "./parser.js";
import { resolveImport, loadTsConfigPaths, type TsConfigPaths } from "./resolver.js";
import type { CodeGraphDB } from "../storage/db.js";

export interface GraphStats {
  edgesCreated: number;
  importsResolved: number;
  importsUnresolved: number;
}

/**
 * Build edges between symbols across files based on resolved imports.
 * Must be called AFTER all files have been inserted into the DB.
 */
export function buildGraph(
  parsedFiles: ParsedFile[],
  rootDir: string,
  db: CodeGraphDB
): GraphStats {
  const tsConfig = loadTsConfigPaths(rootDir);

  // Build a map: absolute file path → file's exported symbols
  const exportsByFile = new Map<string, { id: number; name: string }[]>();
  const allExported = db.getExportedSymbolsWithIds();
  for (const sym of allExported) {
    const existing = exportsByFile.get(sym.path) ?? [];
    existing.push({ id: sym.id, name: sym.name });
    exportsByFile.set(sym.path, existing);
  }

  let edgesCreated = 0;
  let importsResolved = 0;
  let importsUnresolved = 0;

  for (const parsed of parsedFiles) {
    for (const imp of parsed.imports) {
      const targetPath = resolveImport(imp.source, parsed.path, rootDir, tsConfig);
      if (!targetPath) {
        importsUnresolved++;
        continue;
      }

      importsResolved++;
      const targetExports = exportsByFile.get(targetPath);
      if (!targetExports) continue;

      // Get importing file's symbols that use these imports
      const importingFileSymbols = db.getSymbolsByFile(parsed.path);

      // For each imported specifier, find the matching export and create an edge
      if (imp.specifiers.length > 0) {
        for (const specifier of imp.specifiers) {
          const targetSym = targetExports.find((e) => e.name === specifier);
          if (!targetSym) continue;

          // All symbols in the importing file depend on this import
          // But for a cleaner graph, we create a file-level import edge
          // using the first symbol or the file itself
          for (const sourceSym of importingFileSymbols) {
            // Check if this symbol's body references the imported name
            if (sourceSym.body?.includes(specifier)) {
              db.insertEdge(sourceSym.id, targetSym.id, "imports");
              edgesCreated++;
            }
          }
        }
      } else {
        // Default import or namespace import — link all source symbols that reference it
        // to any matching export
        for (const targetSym of targetExports) {
          for (const sourceSym of importingFileSymbols) {
            if (sourceSym.body?.includes(targetSym.name)) {
              db.insertEdge(sourceSym.id, targetSym.id, "imports");
              edgesCreated++;
            }
          }
        }
      }
    }
  }

  return { edgesCreated, importsResolved, importsUnresolved };
}
