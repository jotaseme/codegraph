import { existsSync, readFileSync, statSync } from "fs";
import { join, dirname, resolve } from "path";

export interface TsConfigPaths {
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

export function loadTsConfigPaths(rootDir: string): TsConfigPaths {
  const tsconfigPath = join(rootDir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return {};

  try {
    const raw = readFileSync(tsconfigPath, "utf-8");
    // Strip JSON comments (// and /* */) without breaking string contents
    const stripped = stripJsonComments(raw);
    const config = JSON.parse(stripped);
    return {
      baseUrl: config.compilerOptions?.baseUrl,
      paths: config.compilerOptions?.paths,
    };
  } catch {
    return {};
  }
}

/**
 * Resolve an import specifier to an absolute file path.
 * Returns null if the import can't be resolved (e.g. node_modules).
 */
export function resolveImport(
  importSource: string,
  fromFile: string,
  rootDir: string,
  tsConfig: TsConfigPaths
): string | null {
  // Skip node_modules / bare specifiers (no ./ or ../ or alias)
  if (isBareSpecifier(importSource, tsConfig)) {
    return null;
  }

  // Try tsconfig paths aliases first
  if (tsConfig.paths) {
    const resolved = resolveAlias(importSource, rootDir, tsConfig);
    if (resolved) return resolved;
  }

  // Relative imports
  if (importSource.startsWith(".")) {
    const fromDir = dirname(fromFile);
    const candidate = resolve(fromDir, importSource);
    return tryResolveFile(candidate);
  }

  // baseUrl resolution
  if (tsConfig.baseUrl) {
    const baseDir = resolve(rootDir, tsConfig.baseUrl);
    const candidate = resolve(baseDir, importSource);
    return tryResolveFile(candidate);
  }

  return null;
}

function isBareSpecifier(source: string, tsConfig: TsConfigPaths): boolean {
  if (source.startsWith(".")) return false;
  if (source.startsWith("/")) return false;

  // Check if it matches any alias pattern
  if (tsConfig.paths) {
    for (const pattern of Object.keys(tsConfig.paths)) {
      const prefix = pattern.replace("*", "");
      if (source.startsWith(prefix)) return false;
    }
  }

  return true;
}

function resolveAlias(
  source: string,
  rootDir: string,
  tsConfig: TsConfigPaths
): string | null {
  if (!tsConfig.paths) return null;

  for (const [pattern, targets] of Object.entries(tsConfig.paths)) {
    const prefix = pattern.replace("*", "");

    if (source.startsWith(prefix)) {
      const rest = source.slice(prefix.length);

      for (const target of targets) {
        const targetPrefix = target.replace("*", "");
        const baseDir = tsConfig.baseUrl ? resolve(rootDir, tsConfig.baseUrl) : rootDir;
        const candidate = resolve(baseDir, targetPrefix + rest);
        const resolved = tryResolveFile(candidate);
        if (resolved) return resolved;
      }
    }
  }

  return null;
}

/**
 * Try to resolve a path to an actual file, trying various extensions
 * and index files.
 */
function tryResolveFile(candidate: string): string | null {
  // Exact match
  if (existsSync(candidate) && !isDirectory(candidate)) {
    return candidate;
  }

  // Try adding extensions
  for (const ext of TS_EXTENSIONS) {
    const withExt = candidate + ext;
    if (existsSync(withExt)) return withExt;
  }

  // Strip .js/.jsx extension and try .ts/.tsx (ESM TypeScript pattern)
  if (candidate.endsWith(".js") || candidate.endsWith(".jsx")) {
    const stripped = candidate.replace(/\.jsx?$/, "");
    for (const ext of TS_EXTENSIONS) {
      const withExt = stripped + ext;
      if (existsSync(withExt)) return withExt;
    }
  }

  // Try /index.ts etc.
  for (const ext of TS_EXTENSIONS) {
    const indexFile = join(candidate, `index${ext}`);
    if (existsSync(indexFile)) return indexFile;
  }

  return null;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Strip // and /* comments from JSON, being careful not to touch string contents.
 */
function stripJsonComments(json: string): string {
  let result = "";
  let i = 0;
  let inString = false;

  while (i < json.length) {
    const ch = json[i];

    // Handle string literals
    if (ch === '"' && (i === 0 || json[i - 1] !== "\\")) {
      inString = !inString;
      result += ch;
      i++;
      continue;
    }

    if (inString) {
      result += ch;
      i++;
      continue;
    }

    // Line comment
    if (ch === "/" && json[i + 1] === "/") {
      while (i < json.length && json[i] !== "\n") i++;
      continue;
    }

    // Block comment
    if (ch === "/" && json[i + 1] === "*") {
      i += 2;
      while (i < json.length && !(json[i] === "*" && json[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}
