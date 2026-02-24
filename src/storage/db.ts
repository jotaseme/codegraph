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

  close(): void {
    this.db.close();
  }
}
