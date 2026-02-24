import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CodeGraphDB } from "../storage/db.js";

export async function startMcpServer(dbPath: string): Promise<void> {
  const db = new CodeGraphDB(dbPath);

  const server = new McpServer(
    { name: "codegraph", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "CodeGraph provides structured context about the codebase. Use 'search' to find symbols, 'get_context' to understand a symbol and its relationships, 'get_file_deps' to see a file's imports/exports, and 'project_overview' for high-level structure.",
    }
  );

  // Tool 1: Search symbols via FTS5
  server.registerTool(
    "search",
    {
      description:
        "Search for functions, classes, types, and variables in the codebase using full-text search. Returns ranked results with file paths and signatures.",
      inputSchema: {
        query: z.string().describe("Search query (e.g. 'server', 'getAllServers', 'MCPServer')"),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Max results to return (default 20)"),
      },
    },
    async (args) => {
      const results = db.searchSymbols(args.query, args.limit);
      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No symbols found matching "${args.query}"` }],
        };
      }
      const text = results
        .map((r) => `[${r.type}] ${r.name}\n  file: ${r.path}\n  signature: ${r.signature}`)
        .join("\n\n");
      const responseText = `Found ${results.length} symbols matching "${args.query}":\n\n${text}`;
      const tokensUsed = Math.ceil(responseText.length / 4);
      // Without codegraph: agent would grep + read ~N matching files (~4KB each)
      const tokensSaved = Math.max(0, results.length * 1000 - tokensUsed);
      db.logUsage("search", args.query, tokensUsed, tokensSaved);
      return { content: [{ type: "text" as const, text: responseText }] };
    }
  );

  // Tool 2: Get context for a symbol
  server.registerTool(
    "get_context",
    {
      description:
        "Get a symbol with its full code, dependencies (what it uses), and dependents (what uses it). Returns signatures for related symbols to minimize tokens.",
      inputSchema: {
        name: z.string().describe("Symbol name (e.g. 'getAllServers', 'MCPServer')"),
        include_body: z
          .boolean()
          .optional()
          .default(true)
          .describe("Include full source code of the symbol (default true)"),
      },
    },
    async (args) => {
      const ctx = db.getContext(args.name);
      if (!ctx.symbol) {
        return {
          content: [{ type: "text" as const, text: `Symbol "${args.name}" not found` }],
        };
      }

      let text = `## ${ctx.symbol.type}: ${ctx.symbol.name}\n`;
      text += `file: ${ctx.symbol.path}\n`;
      text += `exported: ${ctx.symbol.exported}\n`;
      text += `signature: ${ctx.symbol.signature}\n`;

      if (args.include_body) {
        text += `\n### Source\n\`\`\`typescript\n${ctx.symbol.body}\n\`\`\`\n`;
      }

      if (ctx.dependencies.length > 0) {
        text += `\n### Dependencies (${ctx.dependencies.length})\n`;
        text += ctx.dependencies
          .map((d) => `- [${d.type}] ${d.name} — ${d.path}\n  ${d.signature}`)
          .join("\n");
      }

      if (ctx.dependents.length > 0) {
        text += `\n\n### Dependents (${ctx.dependents.length})\n`;
        text += ctx.dependents
          .map((d) => `- [${d.type}] ${d.name} — ${d.path}\n  ${d.signature}`)
          .join("\n");
      }

      const tokensUsed = Math.ceil(text.length / 4);
      // Without codegraph: read symbol file + dependency files + dependent files (~4KB each)
      const filesAvoided = 1 + ctx.dependencies.length + ctx.dependents.length;
      const tokensSaved = Math.max(0, filesAvoided * 1000 - tokensUsed);
      db.logUsage("get_context", args.name, tokensUsed, tokensSaved);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // Tool 3: Get file dependencies
  server.registerTool(
    "get_file_deps",
    {
      description:
        "Get all imports and exports for a specific file. Shows what the file depends on and what it exposes.",
      inputSchema: {
        path: z
          .string()
          .describe("File path (absolute or relative to project root)"),
      },
    },
    async (args) => {
      // Try to find the file — could be absolute or relative
      const fileDeps = db.getFileDeps(args.path);

      // If no results, try searching for the path
      if (fileDeps.imports.length === 0 && fileDeps.exports.length === 0) {
        // Try partial match
        const allFiles = db.getAllFilePaths();
        const match = allFiles.find((f) => f.endsWith(args.path) || f.includes(args.path));
        if (match) {
          const result = db.getFileDeps(match);
          return formatFileDeps(match, result);
        }
        return {
          content: [{ type: "text" as const, text: `File "${args.path}" not found in index` }],
        };
      }

      const result = formatFileDeps(args.path, fileDeps);
      const tokensUsed = Math.ceil(result.content[0].text.length / 4);
      const tokensSaved = Math.max(0, 1000 - tokensUsed);
      db.logUsage("get_file_deps", args.path, tokensUsed, tokensSaved);
      return result;
    }
  );

  // Tool 4: Project overview
  server.registerTool(
    "project_overview",
    {
      description:
        "Get high-level project structure: file count, symbol count, most connected symbols (hub nodes), and entry points. Useful for understanding a codebase quickly.",
    },
    async () => {
      const overview = db.getProjectOverview();

      let text = `## Project Overview\n\n`;
      text += `### Stats\n`;
      text += `- Files: ${overview.stats.files}\n`;
      text += `- Symbols: ${overview.stats.symbols}\n`;
      text += `- Imports: ${overview.stats.imports}\n`;
      text += `- Exported symbols: ${overview.stats.exported}\n`;
      text += `- Dependency edges: ${overview.stats.edges}\n`;

      text += `\n### Most Connected Symbols (Hub Nodes)\n`;
      for (const h of overview.hubSymbols) {
        text += `- [${h.type}] ${h.name} — ${h.connections} connections (${h.path})\n`;
      }

      text += `\n### Entry Points\n`;
      for (const e of overview.entryPoints) {
        text += `- ${e.path} (${e.exports} exports)\n`;
      }

      const tokensUsed = Math.ceil(text.length / 4);
      // Without codegraph: read ~15 files to get overview
      const tokensSaved = Math.max(0, 15000 - tokensUsed);
      db.logUsage("project_overview", "", tokensUsed, tokensSaved);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function formatFileDeps(
  path: string,
  deps: {
    imports: { source: string; specifiers: string[]; isTypeOnly: boolean }[];
    exports: { name: string; type: string; signature: string }[];
  }
) {
  let text = `## File: ${path}\n\n`;

  text += `### Imports (${deps.imports.length})\n`;
  for (const imp of deps.imports) {
    const typePrefix = imp.isTypeOnly ? "type " : "";
    text += `- ${typePrefix}import { ${imp.specifiers.join(", ")} } from '${imp.source}'\n`;
  }

  text += `\n### Exports (${deps.exports.length})\n`;
  for (const exp of deps.exports) {
    text += `- [${exp.type}] ${exp.signature}\n`;
  }

  return { content: [{ type: "text" as const, text }] };
}
