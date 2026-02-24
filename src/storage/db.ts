import Database from "better-sqlite3";
import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import type { ParsedFile, ParsedSymbol, ImportInfo } from "../indexer/parser.js";

export class CodeGraphDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        mtime REAL NOT NULL,
        hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY,
        file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        signature TEXT,
        body TEXT,
        exported BOOLEAN DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY,
        source_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
        target_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
        type TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS imports (
        id INTEGER PRIMARY KEY,
        file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        specifiers TEXT,
        is_type_only BOOLEAN DEFAULT 0,
        start_line INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type);
      CREATE INDEX IF NOT EXISTS idx_symbols_exported ON symbols(exported);
      CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_id);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
    `);

    // FTS5 table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
        name, signature, content=symbols, content_rowid=id
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
        INSERT INTO symbols_fts(rowid, name, signature) VALUES (new.id, new.name, new.signature);
      END;
      CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
        INSERT INTO symbols_fts(symbols_fts, rowid, name, signature) VALUES ('delete', old.id, old.name, old.signature);
      END;
      CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
        INSERT INTO symbols_fts(symbols_fts, rowid, name, signature) VALUES ('delete', old.id, old.name, old.signature);
        INSERT INTO symbols_fts(rowid, name, signature) VALUES (new.id, new.name, new.signature);
      END;
    `);
  }

  insertParsedFile(parsedFile: ParsedFile): void {
    const filePath = parsedFile.path;
    let mtime = 0;
    let hash = "";

    try {
      const st = statSync(filePath);
      mtime = st.mtimeMs;
      hash = createHash("md5").update(readFileSync(filePath)).digest("hex");
    } catch {
      // File might not exist if parsing from string
    }

    const insertFile = this.db.prepare(
      "INSERT OR REPLACE INTO files (path, mtime, hash) VALUES (?, ?, ?)"
    );
    const fileResult = insertFile.run(filePath, mtime, hash);
    const fileId = fileResult.lastInsertRowid as number;

    // Delete old symbols and imports for this file
    this.db.prepare("DELETE FROM symbols WHERE file_id = ?").run(fileId);
    this.db.prepare("DELETE FROM imports WHERE file_id = ?").run(fileId);

    // Insert symbols
    const insertSymbol = this.db.prepare(`
      INSERT INTO symbols (file_id, name, type, start_line, end_line, signature, body, exported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const sym of parsedFile.symbols) {
      insertSymbol.run(
        fileId,
        sym.name,
        sym.type,
        sym.startLine,
        sym.endLine,
        sym.signature,
        sym.body,
        sym.exported ? 1 : 0
      );
    }

    // Insert imports
    const insertImport = this.db.prepare(`
      INSERT INTO imports (file_id, source, specifiers, is_type_only, start_line)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const imp of parsedFile.imports) {
      insertImport.run(
        fileId,
        imp.source,
        JSON.stringify(imp.specifiers),
        imp.isTypeOnly ? 1 : 0,
        imp.startLine
      );
    }
  }

  insertBatch(parsedFiles: ParsedFile[]): void {
    const transaction = this.db.transaction(() => {
      for (const file of parsedFiles) {
        this.insertParsedFile(file);
      }
    });
    transaction();
  }

  // Queries
  getExportedFunctions(): { path: string; name: string; signature: string }[] {
    return this.db.prepare(`
      SELECT f.path, s.name, s.signature
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.exported = 1 AND s.type = 'function'
      ORDER BY f.path, s.start_line
    `).all() as any[];
  }

  searchSymbols(query: string, limit = 20): { path: string; name: string; type: string; signature: string; rank: number }[] {
    return this.db.prepare(`
      SELECT f.path, s.name, s.type, s.signature, fts.rank
      FROM symbols_fts fts
      JOIN symbols s ON s.id = fts.rowid
      JOIN files f ON s.file_id = f.id
      WHERE symbols_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(query, limit) as any[];
  }

  getStats(): { files: number; symbols: number; imports: number; exported: number } {
    const files = (this.db.prepare("SELECT COUNT(*) as count FROM files").get() as any).count;
    const symbols = (this.db.prepare("SELECT COUNT(*) as count FROM symbols").get() as any).count;
    const imports = (this.db.prepare("SELECT COUNT(*) as count FROM imports").get() as any).count;
    const exported = (this.db.prepare("SELECT COUNT(*) as count FROM symbols WHERE exported = 1").get() as any).count;
    return { files, symbols, imports, exported };
  }

  getSymbol(name: string): { path: string; name: string; type: string; signature: string; body: string; startLine: number; endLine: number; exported: boolean }[] {
    return this.db.prepare(`
      SELECT f.path, s.name, s.type, s.signature, s.body, s.start_line as startLine, s.end_line as endLine, s.exported
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name = ?
    `).all(name) as any[];
  }

  // Graph methods
  getExportedSymbolsWithIds(): { id: number; name: string; path: string }[] {
    return this.db.prepare(`
      SELECT s.id, s.name, f.path
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.exported = 1
    `).all() as any[];
  }

  getSymbolsByFile(filePath: string): { id: number; name: string; type: string; body: string }[] {
    return this.db.prepare(`
      SELECT s.id, s.name, s.type, s.body
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE f.path = ?
    `).all(filePath) as any[];
  }

  insertEdge(sourceId: number, targetId: number, type: string): void {
    this.db.prepare(
      "INSERT INTO edges (source_id, target_id, type) VALUES (?, ?, ?)"
    ).run(sourceId, targetId, type);
  }

  // Get symbols that depend on a given symbol (who uses it)
  getDependents(symbolName: string): { id: number; name: string; type: string; path: string; signature: string }[] {
    return this.db.prepare(`
      SELECT DISTINCT s.id, s.name, s.type, f.path, s.signature
      FROM edges e
      JOIN symbols target ON e.target_id = target.id
      JOIN symbols s ON e.source_id = s.id
      JOIN files f ON s.file_id = f.id
      WHERE target.name = ?
    `).all(symbolName) as any[];
  }

  // Get symbols that a given symbol depends on
  getDependencies(symbolName: string): { id: number; name: string; type: string; path: string; signature: string }[] {
    return this.db.prepare(`
      SELECT DISTINCT s.id, s.name, s.type, f.path, s.signature
      FROM edges e
      JOIN symbols source ON e.source_id = source.id
      JOIN symbols s ON e.target_id = s.id
      JOIN files f ON s.file_id = f.id
      WHERE source.name = ?
    `).all(symbolName) as any[];
  }

  // Get context for a symbol: the symbol itself + its dependencies + its dependents
  getContext(symbolName: string, depth: number = 1): {
    symbol: { name: string; type: string; path: string; signature: string; body: string; exported: boolean } | null;
    dependencies: { name: string; type: string; path: string; signature: string }[];
    dependents: { name: string; type: string; path: string; signature: string }[];
  } {
    const symbols = this.getSymbol(symbolName);
    if (symbols.length === 0) return { symbol: null, dependencies: [], dependents: [] };

    const symbol = symbols[0];
    const dependencies = this.getDependencies(symbolName);
    const dependents = this.getDependents(symbolName);

    return {
      symbol: {
        name: symbol.name,
        type: symbol.type,
        path: symbol.path,
        signature: symbol.signature,
        body: symbol.body,
        exported: !!symbol.exported,
      },
      dependencies: dependencies.map((d) => ({
        name: d.name,
        type: d.type,
        path: d.path,
        signature: d.signature,
      })),
      dependents: dependents.map((d) => ({
        name: d.name,
        type: d.type,
        path: d.path,
        signature: d.signature,
      })),
    };
  }

  // Get file dependencies
  getFileDeps(filePath: string): {
    imports: { source: string; specifiers: string[]; isTypeOnly: boolean }[];
    exports: { name: string; type: string; signature: string }[];
  } {
    const fileImports = this.db.prepare(`
      SELECT source, specifiers, is_type_only
      FROM imports i
      JOIN files f ON i.file_id = f.id
      WHERE f.path = ?
    `).all(filePath) as any[];

    const fileExports = this.db.prepare(`
      SELECT s.name, s.type, s.signature
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE f.path = ? AND s.exported = 1
    `).all(filePath) as any[];

    return {
      imports: fileImports.map((i: any) => ({
        source: i.source,
        specifiers: JSON.parse(i.specifiers || "[]"),
        isTypeOnly: !!i.is_type_only,
      })),
      exports: fileExports,
    };
  }

  // Project overview: most connected symbols (hub nodes)
  getProjectOverview(): {
    stats: { files: number; symbols: number; imports: number; exported: number; edges: number };
    hubSymbols: { name: string; type: string; path: string; signature: string; connections: number }[];
    entryPoints: { path: string; exports: number }[];
  } {
    const stats = this.getStats();
    const edges = (this.db.prepare("SELECT COUNT(*) as count FROM edges").get() as any).count;

    // Hub symbols: most referenced (most incoming edges)
    const hubSymbols = this.db.prepare(`
      SELECT s.name, s.type, f.path, s.signature, COUNT(e.source_id) as connections
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      JOIN edges e ON e.target_id = s.id
      GROUP BY s.id
      ORDER BY connections DESC
      LIMIT 20
    `).all() as any[];

    // Entry points: files with exports but few/no incoming edges
    const entryPoints = this.db.prepare(`
      SELECT f.path, COUNT(s.id) as exports
      FROM files f
      JOIN symbols s ON s.file_id = f.id
      WHERE s.exported = 1
      AND f.path LIKE '%/page.%' OR f.path LIKE '%/route.%' OR f.path LIKE '%/layout.%'
      GROUP BY f.id
      ORDER BY f.path
    `).all() as any[];

    return {
      stats: { ...stats, edges },
      hubSymbols,
      entryPoints,
    };
  }

  getAllFilePaths(): string[] {
    return (this.db.prepare("SELECT path FROM files ORDER BY path").all() as any[]).map(
      (r) => r.path
    );
  }

  getGraphNodes(): { id: string; name: string; type: string; path: string; connections: number; exported: boolean }[] {
    return this.db.prepare(`
      SELECT
        CAST(s.id AS TEXT) as id,
        s.name,
        s.type,
        f.path,
        s.exported,
        (
          (SELECT COUNT(*) FROM edges WHERE source_id = s.id) +
          (SELECT COUNT(*) FROM edges WHERE target_id = s.id)
        ) as connections
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      ORDER BY connections DESC
    `).all() as any[];
  }

  getGraphEdges(): { source: string; target: string; type: string }[] {
    return this.db.prepare(`
      SELECT CAST(source_id AS TEXT) as source, CAST(target_id AS TEXT) as target, type
      FROM edges
    `).all() as any[];
  }

  close(): void {
    this.db.close();
  }
}
