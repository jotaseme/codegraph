import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CodeGraphDB } from "./storage/db.js";
import { z } from "zod";

// We'll test the MCP tools directly through the DB
const DB_PATH = "/Users/jotaeme/projects/webs/mcpfast/.codegraph.db";

async function main() {
  console.log("\n=== MCP Server Test ===\n");

  const db = new CodeGraphDB(DB_PATH);

  // Test each tool's underlying logic

  // Tool 1: Search
  console.log("--- Tool: search ---");
  const searchResults = db.searchSymbols("server", 5);
  console.log(`  Results for "server": ${searchResults.length}`);
  for (const r of searchResults) {
    console.log(`    [${r.type}] ${r.name} — ${r.path.split("/").pop()}`);
  }

  // Tool 2: Get context
  console.log("\n--- Tool: get_context ---");
  const ctx = db.getContext("getAllServers");
  console.log(`  Symbol: ${ctx.symbol?.signature}`);
  console.log(`  Dependencies: ${ctx.dependencies.length}`);
  console.log(`  Dependents: ${ctx.dependents.length}`);

  // Tool 3: File deps
  console.log("\n--- Tool: get_file_deps ---");
  const fileDeps = db.getFileDeps("/Users/jotaeme/projects/webs/mcpfast/src/lib/data.ts");
  console.log(`  Imports: ${fileDeps.imports.length}`);
  console.log(`  Exports: ${fileDeps.exports.length}`);
  for (const exp of fileDeps.exports.slice(0, 3)) {
    console.log(`    [${exp.type}] ${exp.signature}`);
  }

  // Tool 4: Project overview
  console.log("\n--- Tool: project_overview ---");
  const overview = db.getProjectOverview();
  console.log(`  Files: ${overview.stats.files}`);
  console.log(`  Symbols: ${overview.stats.symbols}`);
  console.log(`  Edges: ${overview.stats.edges}`);
  console.log(`  Top hub: ${overview.hubSymbols[0]?.name} (${overview.hubSymbols[0]?.connections} connections)`);

  db.close();

  // Now test the actual MCP server with in-memory transport
  console.log("\n--- MCP Protocol Test ---");
  try {
    const { startMcpServer } = await import("./server/mcp.js");

    // Create an in-memory client-server pair
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Start MCP server on server transport
    const serverDb = new CodeGraphDB(DB_PATH);
    const server = new McpServer(
      { name: "codegraph", version: "0.1.0" },
      { capabilities: { tools: {} } }
    );

    // Register a simple test tool
    server.registerTool(
      "search",
      {
        description: "Search symbols",
        inputSchema: { query: z.string(), limit: z.number().optional().default(5) },
      },
      async (args) => {
        const results = serverDb.searchSymbols(args.query, args.limit);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(results.map((r) => ({ name: r.name, type: r.type, file: r.path.split("/").pop() })), null, 2),
          }],
        };
      }
    );

    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    // Call the tool
    const result = await client.callTool({ name: "search", arguments: { query: "getAllServers" } });
    console.log("  MCP call result:");
    for (const content of result.content as any[]) {
      console.log(`    ${content.text?.substring(0, 200)}`);
    }

    await client.close();
    serverDb.close();
  } catch (e) {
    console.log(`  MCP protocol test error: ${(e as Error).message}`);
  }

  console.log("\n=== MCP Test Complete ===");
}

main().catch(console.error);
