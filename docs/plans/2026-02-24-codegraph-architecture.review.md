# CodeGraph — Arquitectura y Plan Tecnico

**Fecha:** 2026-02-24
**Estado:** Exploracion tecnica
**Objetivo:** Entender como funciona por dentro un context engine para AI coding agents

---

## 1. QUE ES CODEGRAPH

Un context engine local que analiza tu codebase, construye un grafo de dependencias, y sirve contexto estructurado a tu agente IA via MCP. El agente no explora archivos — recibe contexto pre-analizado.

**Resultado para el usuario:** Menos tokens quemados, respuestas mas completas, contexto que persiste entre sesiones.

---

## 2. COMO FUNCIONA (vista de pajaro)

```
Tu codebase
    |
    v
[1. INDEXAR]  tree-sitter parsea cada archivo
    |          extrae: funciones, clases, imports, exports, tipos
    v
[2. GRAFO]    resuelve imports entre archivos
    |          construye grafo: nodo = symbol, arista = "usa/importa/llama"
    v
[3. GUARDAR]  SQLite local (.codegraph.db)
    |          tabla symbols + tabla edges + FTS5 full-text search
    v
[4. SERVIR]   MCP server (stdio)
    |          el agente llama tools: search, get_context, get_dependencies
    v
Claude Code / Cursor / Windsurf
    recibe solo el contexto relevante, no archivos enteros
```

---

## 3. CADA PASO EN DETALLE

### Paso 1: Indexar (tree-sitter)

**Que es tree-sitter:** Un parser que convierte codigo fuente en un arbol sintactico (AST). Es lo que usan VS Code, Neovim, y GitHub para syntax highlighting. Soporta 100+ lenguajes.

**Como se usa desde TypeScript:**

```typescript
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";

const parser = new Parser();
parser.setLanguage(TypeScript.typescript);

const sourceCode = `
export function calculateScore(server: MCPServer): number {
  const stars = Math.log(server.githubStars) * 15;
  return stars;
}
`;

const tree = parser.parse(sourceCode);
// tree.rootNode contiene el AST completo
```

**Que extraemos del AST:**

Para cada archivo, extraemos "symbols":

| Tipo | Ejemplo | Query tree-sitter |
|------|---------|-------------------|
| Funcion | `function calculateScore()` | `(function_declaration name: (identifier) @name)` |
| Clase | `class ServerCard` | `(class_declaration name: (type_identifier) @name)` |
| Import | `import { cn } from './utils'` | `(import_statement source: (string) @source)` |
| Export | `export function getAllServers()` | `(export_statement)` |
| Type/Interface | `interface MCPServer` | `(interface_declaration name: (type_identifier) @name)` |
| Variable const | `const BASE_URL = ...` | `(variable_declarator name: (identifier) @name)` |

**Cada symbol se guarda con:**
- `id`: hash unico
- `file`: ruta relativa (`src/lib/data.ts`)
- `name`: nombre del symbol (`calculateScore`)
- `type`: function | class | interface | import | export | variable
- `startLine` / `endLine`: donde esta en el archivo
- `signature`: firma sin el cuerpo (`function calculateScore(server: MCPServer): number`)
- `body`: codigo completo (para cuando el agente lo necesite)

**Rendimiento:** tree-sitter parsea 5,000 archivos en <15 segundos. Es C compilado a WASM.

### Paso 2: Construir el grafo

Aqui es donde se conectan los symbols entre archivos.

**Ejemplo concreto con mcpfast:**

```
src/lib/data.ts
  exports: getAllServers(), getServer(), getAllStacks()
  imports: ./types (MCPServer, Stack)
  imports: fs, path (node built-ins)

src/app/servers/page.tsx
  imports: ../lib/data (getAllServers)
  imports: ../components/servers/server-list (ServerList)

src/components/servers/server-list.tsx
  imports: ../lib/types (MCPServer)
  imports: ./server-card (ServerCard)
```

**El grafo resultante:**

```
getAllServers() ──usada-por──> servers/page.tsx
                ──usada-por──> components/server-list.tsx
MCPServer       ──usada-por──> data.ts, server-list.tsx, server-card.tsx, ...
ServerCard      ──usada-por──> server-list.tsx
```

**Como se resuelven los imports:**

1. Leer el string del import: `from '../lib/data'`
2. Resolver ruta relativa desde el archivo actual
3. Buscar archivo: `data.ts`, `data.tsx`, `data/index.ts`
4. Si hay `tsconfig.json` con `paths`: resolver aliases (`@/lib/data` -> `src/lib/data`)
5. Crear arista en el grafo: archivo A -> archivo B

**Lo que NO resolvemos en el MVP:**
- `node_modules` (too complex, no aporta valor)
- Dynamic imports (`import('./chunk-' + name)`)
- Re-exports complejos
- Monorepos con workspaces

### Paso 3: Guardar en SQLite

**Schema:**

```sql
-- Archivos indexados
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  mtime REAL NOT NULL,          -- para saber si cambio
  hash TEXT NOT NULL             -- para detectar cambios
);

-- Symbols extraidos
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  file_id INTEGER REFERENCES files(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,            -- function|class|interface|import|export|variable
  start_line INTEGER,
  end_line INTEGER,
  signature TEXT,                -- firma sin cuerpo
  body TEXT,                     -- codigo completo
  exported BOOLEAN DEFAULT 0
);

-- Relaciones entre symbols/archivos
CREATE TABLE edges (
  source_id INTEGER REFERENCES symbols(id),
  target_id INTEGER REFERENCES symbols(id),
  type TEXT NOT NULL             -- imports|calls|implements|extends
);

-- Full-text search sobre nombres y signatures
CREATE VIRTUAL TABLE symbols_fts USING fts5(
  name, signature, content=symbols, content_rowid=id
);
```

**Por que SQLite:**
- Zero config (un archivo .db en la raiz del proyecto)
- FTS5 built-in (busqueda full-text con ranking BM25)
- Rapido para reads (WAL mode)
- El usuario no instala nada extra

**Tamano estimado:** ~10-15 MB para un proyecto de 5,000 archivos.

### Paso 4: Servir via MCP

**Que es MCP:** Model Context Protocol. Un estandar para que agentes IA (Claude Code, Cursor) llamen a herramientas externas. El agente llama un "tool" y recibe datos estructurados.

**Tools que exponemos:**

```typescript
// Tool 1: Buscar symbols
server.registerTool("search", {
  description: "Search for functions, classes, types in the codebase",
  inputSchema: { query: z.string(), type: z.enum(["function","class","interface","all"]).optional() }
}, async ({ query, type }) => {
  // SELECT * FROM symbols_fts WHERE symbols_fts MATCH ?
  return matchingSymbols;
});

// Tool 2: Obtener contexto de un symbol
server.registerTool("get_context", {
  description: "Get a symbol with its dependencies and dependents",
  inputSchema: { name: z.string(), depth: z.number().default(1) }
}, async ({ name, depth }) => {
  // 1. Buscar el symbol
  // 2. Seguir aristas del grafo hasta `depth` niveles
  // 3. Devolver: symbol completo + dependencias como signatures (sin cuerpo)
  return contextCapsule;
});

// Tool 3: Obtener dependencias de un archivo
server.registerTool("get_file_deps", {
  description: "Get all imports and exports for a file",
  inputSchema: { path: z.string() }
}, async ({ path }) => {
  return fileDependencies;
});

// Tool 4: Resumen del proyecto
server.registerTool("project_overview", {
  description: "Get high-level project structure: key files, entry points, main types",
  inputSchema: {}
}, async () => {
  // Los symbols mas conectados (hub nodes del grafo)
  // Entry points (archivos sin importadores)
  // Tipos mas usados
  return overview;
});
```

**Como lo usa el agente:**

Antes (sin CodeGraph):
```
Claude Code: "Necesito entender data.ts"
→ Lee data.ts (500 lineas, 2000 tokens)
→ Lee types.ts para entender los tipos (300 lineas, 1200 tokens)
→ Lee 3 archivos que importan data.ts (1500 lineas, 6000 tokens)
→ Total: ~9200 tokens para entender un archivo
```

Despues (con CodeGraph):
```
Claude Code: tool call → get_context("getAllServers", depth=1)
→ Recibe: signature de getAllServers + tipos usados + quien la llama (solo signatures)
→ Total: ~800 tokens
→ Reduccion: ~91%
```

---

## 4. DIFERENCIADOR: DASHBOARD WEB

Lo que nadie mas tiene. Cuando corres `codegraph serve`:

- Abre un dashboard local (localhost:3000)
- Ves tu proyecto como un grafo interactivo (nodos = archivos/symbols, aristas = imports)
- Click en un nodo → ves sus dependencias, quien lo usa, signature
- Busqueda rapida de symbols
- Stats: archivos indexados, symbols, tokens estimados

**Tech:** El mismo server que sirve MCP tambien sirve una web app. Un solo proceso.

**Por que importa:** Vexp/Scope son CLI puro. No ves nada. Tu ves tu codebase de forma visual y entiendes las conexiones.

---

## 5. STACK TECNICO

```
TypeScript (todo el proyecto)
├── tree-sitter (web-tree-sitter, WASM) — parsing
├── better-sqlite3 — storage + FTS5
├── @modelcontextprotocol/sdk — MCP server
├── chokidar — file watching (re-indexar cambios)
├── tsconfig-paths — resolver aliases de TypeScript
└── React + Vite — dashboard web (embebido en el binario o servido aparte)
```

**Por que TypeScript y no Rust (como Vexp):**
- Tu stack. Lo conoces.
- tree-sitter tiene bindings WASM que funcionan en Node
- El rendimiento es suficiente (no necesitas parsear 100K archivos)
- Puedes reutilizar React para el dashboard
- Distribucion mas facil: `npx codegraph` vs compilar Rust

**Estructura de archivos del proyecto:**

```
codegraph/
├── src/
│   ├── cli.ts              — entry point: `codegraph index`, `codegraph serve`
│   ├── indexer/
│   │   ├── walker.ts        — recorre archivos, respeta .gitignore
│   │   ├── parser.ts        — tree-sitter parsing + symbol extraction
│   │   ├── resolver.ts      — resolucion de imports entre archivos
│   │   └── graph.ts         — construye el grafo de dependencias
│   ├── storage/
│   │   ├── db.ts            — SQLite schema + queries
│   │   └── search.ts        — FTS5 search wrapper
│   ├── server/
│   │   ├── mcp.ts           — MCP server con tools
│   │   └── web.ts           — dashboard web server
│   └── dashboard/           — React app (Vite)
│       ├── App.tsx
│       ├── GraphView.tsx    — visualizacion del grafo
│       └── SearchView.tsx   — busqueda de symbols
├── package.json
├── tsconfig.json
└── .codegraph.db            — se genera en la raiz del proyecto del usuario
```

---

## 6. PLAN DE EJECUCION

### Fase 1: Proof of Concept (3-4 dias)

**Objetivo:** Parsear mcpfast con tree-sitter, ver si funciona.

- [ ] Instalar web-tree-sitter + grammar TS
- [ ] Parsear un archivo (data.ts) y extraer symbols
- [ ] Parsear todos los .ts/.tsx de mcpfast
- [ ] Guardar en SQLite
- [ ] Query basica: "dame todas las funciones exportadas"

**Resultado:** Saber si la tecnologia funciona y cuanto cuesta aprenderla.

### Fase 2: MVP funcional (2 semanas)

- [ ] File walker con .gitignore
- [ ] Extraccion de symbols para JS/TS (funciones, clases, imports, exports, types)
- [ ] Resolucion basica de imports (relative paths + tsconfig paths)
- [ ] SQLite con FTS5
- [ ] MCP server con 4 tools (search, get_context, get_file_deps, project_overview)
- [ ] CLI: `codegraph index` + `codegraph serve`
- [ ] Probar con Claude Code en mcpfast

### Fase 3: Dashboard (1 semana)

- [ ] Web app React con Vite
- [ ] Visualizacion de grafo (d3-force o similar)
- [ ] Busqueda de symbols
- [ ] Vista de archivo con symbols destacados

### Fase 4: Polish + lanzamiento (1 semana)

- [ ] `npx codegraph` funciona sin instalar nada
- [ ] README con GIF/video
- [ ] Publicar en npm
- [ ] Post en HN, Reddit, Twitter
- [ ] Listar en MCP marketplaces

**Total: ~4-5 semanas hasta lanzamiento**

---

## 7. LO QUE NO SE AUN

Preguntas abiertas que el PoC resolvera:

1. **web-tree-sitter vs tree-sitter nativo:** El binding WASM es mas lento que el nativo. Para un MVP da igual, pero hay que probarlo
2. **Resolucion de imports:** Es el reto tecnico real. Hasta que no lo implemente no se cuanto me va a costar
3. **Tamano del contexto:** Cuanto reduce realmente en un proyecto real como mcpfast?
4. **Rendimiento en proyectos grandes:** mcpfast tiene ~100 archivos TS. Funciona con 1000? 5000?

---

## 8. MONETIZACION (solo si hay traccion)

| Tier | Precio | Que incluye |
|------|--------|-------------|
| Free | $0 | CLI + MCP server + 3 tools + 1 lenguaje (TS) |
| Pro | $19/mo | Dashboard web + todos los tools + multi-lenguaje + file watching |
| Team | $49/mo | Shared context across team + CI integration |

**Modelo Vexp/Scope:** Free generoso para adopcion, Pro para power users.

**No monetizar hasta tener 500+ usuarios activos.**

> **[REVIEW COMMENT — Line 377]**: lo dejo gratis¿?

---

*Siguiente paso: Fase 1 PoC. Parsear mcpfast con tree-sitter.*
