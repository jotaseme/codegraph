import { watch, type FSWatcher } from "fs";
import { join, extname } from "path";
import { parseFile } from "./parser.js";
import { walkDirectory } from "./walker.js";
import { buildGraph } from "./graph.js";
import { CodeGraphDB } from "../storage/db.js";

const WATCHED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE_PATTERNS = ["node_modules", ".git", ".next", "dist", "build", ".codegraph"];

export interface WatcherOptions {
  rootDir: string;
  dbPath: string;
  debounceMs?: number;
  onReindex?: (stats: { files: number; symbols: number; edges: number; timeMs: number }) => void;
}

export function startWatcher(options: WatcherOptions): FSWatcher {
  const { rootDir, dbPath, debounceMs = 500, onReindex } = options;

  let timeout: ReturnType<typeof setTimeout> | null = null;
  let indexing = false;

  const reindex = async () => {
    if (indexing) return;
    indexing = true;

    try {
      const start = performance.now();
      const files = await walkDirectory({ rootDir });
      const parsedFiles = [];

      for (const file of files) {
        try {
          parsedFiles.push(await parseFile(file));
        } catch {
          // skip unparseable files
        }
      }

      const db = new CodeGraphDB(dbPath);
      db.insertBatch(parsedFiles);
      const graphStats = buildGraph(parsedFiles, rootDir, db);
      const overview = db.getProjectOverview();
      db.close();

      const timeMs = Math.round(performance.now() - start);

      if (onReindex) {
        onReindex({
          files: overview.stats.files,
          symbols: overview.stats.symbols,
          edges: overview.stats.edges,
          timeMs,
        });
      }
    } catch (e) {
      console.error(`  [watch] reindex error: ${(e as Error).message}`);
    } finally {
      indexing = false;
    }
  };

  const scheduleReindex = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(reindex, debounceMs);
  };

  const watcher = watch(rootDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;

    // Ignore non-source files
    const ext = extname(filename);
    if (!WATCHED_EXTENSIONS.has(ext)) return;

    // Ignore patterns
    for (const pattern of IGNORE_PATTERNS) {
      if (filename.includes(pattern)) return;
    }

    scheduleReindex();
  });

  return watcher;
}
