import { readdir, stat, readFile } from "fs/promises";
import { join, relative } from "path";
import { existsSync } from "fs";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  ".vercel",
  "coverage",
  "__pycache__",
]);

export interface WalkOptions {
  extensions?: Set<string>;
  rootDir: string;
}

export async function walkDirectory(options: WalkOptions): Promise<string[]> {
  const { rootDir, extensions = TS_EXTENSIONS } = options;

  // Load .gitignore patterns (simple implementation)
  const gitignorePatterns = await loadGitignore(rootDir);

  const files: string[] = [];
  await walk(rootDir, rootDir, extensions, gitignorePatterns, files);
  return files;
}

async function walk(
  dir: string,
  rootDir: string,
  extensions: Set<string>,
  gitignorePatterns: string[],
  results: string[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    // Skip default ignored dirs
    if (entry.isDirectory() && DEFAULT_IGNORE.has(entry.name)) continue;

    // Skip dotfiles/dirs (except the root)
    if (entry.name.startsWith(".") && entry.name !== ".") continue;

    // Check gitignore
    if (matchesGitignore(relPath, entry.isDirectory(), gitignorePatterns)) continue;

    if (entry.isDirectory()) {
      await walk(fullPath, rootDir, extensions, gitignorePatterns, results);
    } else if (entry.isFile()) {
      const ext = getExtension(entry.name);
      if (extensions.has(ext)) {
        results.push(fullPath);
      }
    }
  }
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.slice(lastDot);
}

async function loadGitignore(rootDir: string): Promise<string[]> {
  const gitignorePath = join(rootDir, ".gitignore");
  if (!existsSync(gitignorePath)) return [];

  const content = await readFile(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function matchesGitignore(
  relPath: string,
  isDir: boolean,
  patterns: string[]
): boolean {
  for (const pattern of patterns) {
    // Simple pattern matching — handles most common cases
    let p = pattern;

    // Remove trailing slash (indicates dir-only pattern)
    const dirOnly = p.endsWith("/");
    if (dirOnly) {
      p = p.slice(0, -1);
      if (!isDir) continue;
    }

    // Exact match
    if (relPath === p) return true;

    // Directory prefix match
    if (relPath.startsWith(p + "/")) return true;

    // Basename match (patterns without /)
    if (!p.includes("/")) {
      const basename = relPath.split("/").pop() ?? "";
      if (basename === p) return true;

      // Simple glob: *.ext
      if (p.startsWith("*.")) {
        const ext = p.slice(1); // .ext
        if (basename.endsWith(ext)) return true;
      }
    }
  }
  return false;
}
