import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { CodeGraphDB } from "../storage/db.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startWebServer(dbPath: string, port = 3000): void {
  const db = new CodeGraphDB(dbPath);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    // CORS for dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (pathname === "/api/stats") {
        json(res, db.getProjectOverview());
      } else if (pathname === "/api/search") {
        const q = url.searchParams.get("q") ?? "";
        const limit = parseInt(url.searchParams.get("limit") ?? "20");
        json(res, db.searchSymbols(q, limit));
      } else if (pathname.startsWith("/api/symbol/")) {
        const name = decodeURIComponent(pathname.slice("/api/symbol/".length));
        json(res, db.getContext(name));
      } else if (pathname === "/api/file-deps") {
        const path = url.searchParams.get("path") ?? "";
        json(res, db.getFileDeps(path));
      } else if (pathname === "/api/graph") {
        json(res, getGraphData(db));
      } else if (pathname === "/api/files") {
        json(res, db.getAllFilePaths());
      } else if (pathname === "/" || pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(getDashboardHtml());
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });

  server.listen(port, () => {
    console.error(`  dashboard: http://localhost:${port}`);
  });
}

function json(res: ServerResponse, data: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

interface GraphNode {
  id: string;
  name: string;
  type: string;
  path: string;
  connections: number;
  exported: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

function getGraphData(db: CodeGraphDB): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // Get all symbols with their connection counts
  const nodes = db.getGraphNodes();
  const edges = db.getGraphEdges();
  return { nodes, edges };
}

function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeGraph Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0a0a0a; color: #e0e0e0; height: 100vh; overflow: hidden;
      display: flex;
    }
    #sidebar {
      width: 380px; min-width: 380px; background: #111; border-right: 1px solid #222;
      display: flex; flex-direction: column; height: 100vh; overflow: hidden;
    }
    #sidebar-header {
      padding: 16px; border-bottom: 1px solid #222;
    }
    #sidebar-header h1 {
      font-size: 18px; font-weight: 600; color: #fff; margin-bottom: 8px;
    }
    #search-box {
      width: 100%; padding: 8px 12px; background: #1a1a1a; border: 1px solid #333;
      border-radius: 6px; color: #fff; font-size: 14px; outline: none;
      font-family: inherit;
    }
    #search-box:focus { border-color: #4a9eff; }
    #search-box::placeholder { color: #666; }
    .stats {
      padding: 12px 16px; border-bottom: 1px solid #222; font-size: 12px; color: #888;
      display: flex; gap: 16px;
    }
    .stat-item { display: flex; flex-direction: column; }
    .stat-value { font-size: 18px; font-weight: 600; color: #4a9eff; }
    .stat-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
    #results {
      flex: 1; overflow-y: auto; padding: 8px;
    }
    .result-item {
      padding: 10px 12px; border-radius: 6px; cursor: pointer; margin-bottom: 4px;
      border: 1px solid transparent;
    }
    .result-item:hover { background: #1a1a2a; border-color: #333; }
    .result-item.active { background: #1a1a3a; border-color: #4a9eff; }
    .result-name { font-size: 14px; font-weight: 500; color: #fff; }
    .result-type {
      font-size: 11px; padding: 1px 6px; border-radius: 3px; margin-left: 6px;
      display: inline-block; font-weight: 500;
    }
    .type-function { background: #1a3a1a; color: #4aff7a; }
    .type-class { background: #3a1a3a; color: #c77dff; }
    .type-interface { background: #1a2a3a; color: #4a9eff; }
    .type-variable { background: #3a3a1a; color: #ffd94a; }
    .type-type_alias { background: #1a3a3a; color: #4affd9; }
    .result-path { font-size: 11px; color: #666; margin-top: 2px; }
    .result-sig { font-size: 12px; color: #999; margin-top: 4px; font-family: 'SF Mono', monospace; }
    #main {
      flex: 1; position: relative; display: flex; flex-direction: column;
    }
    #graph-container { flex: 1; position: relative; }
    #graph-container svg { width: 100%; height: 100%; }
    .node circle { cursor: pointer; stroke-width: 2; }
    .node text { font-size: 10px; fill: #888; pointer-events: none; }
    .link { stroke-opacity: 0.3; }
    #detail-panel {
      position: absolute; top: 16px; right: 16px; width: 450px;
      background: #111; border: 1px solid #333; border-radius: 8px;
      max-height: calc(100vh - 32px); overflow-y: auto; display: none;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    #detail-panel.visible { display: block; }
    .detail-header {
      padding: 16px; border-bottom: 1px solid #222;
      display: flex; justify-content: space-between; align-items: start;
    }
    .detail-close {
      background: none; border: none; color: #666; cursor: pointer;
      font-size: 18px; padding: 4px 8px;
    }
    .detail-close:hover { color: #fff; }
    .detail-body { padding: 16px; }
    .detail-section { margin-bottom: 16px; }
    .detail-section h3 {
      font-size: 12px; color: #666; text-transform: uppercase;
      letter-spacing: 0.5px; margin-bottom: 8px;
    }
    .detail-code {
      background: #0d0d0d; border: 1px solid #222; border-radius: 6px;
      padding: 12px; font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px; line-height: 1.5; overflow-x: auto; color: #c9d1d9;
      white-space: pre;
    }
    .dep-item {
      padding: 6px 8px; border-radius: 4px; margin-bottom: 2px;
      font-size: 12px; cursor: pointer;
    }
    .dep-item:hover { background: #1a1a2a; }
    .dep-name { color: #4a9eff; }
    .dep-path { color: #666; font-size: 11px; }
    #legend {
      position: absolute; bottom: 16px; left: 16px;
      background: #111; border: 1px solid #222; border-radius: 6px;
      padding: 12px; font-size: 11px;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
    #toolbar {
      position: absolute; top: 16px; left: 16px;
      display: flex; gap: 8px;
    }
    .toolbar-btn {
      padding: 6px 12px; background: #1a1a1a; border: 1px solid #333;
      border-radius: 6px; color: #ccc; cursor: pointer; font-size: 12px;
      font-family: inherit;
    }
    .toolbar-btn:hover { background: #2a2a2a; border-color: #4a9eff; }
    .toolbar-btn.active { background: #1a1a3a; border-color: #4a9eff; color: #4a9eff; }
  </style>
</head>
<body>
  <div id="sidebar">
    <div id="sidebar-header">
      <h1>CodeGraph</h1>
      <input type="text" id="search-box" placeholder="Search symbols..." autofocus />
    </div>
    <div class="stats" id="stats"></div>
    <div id="results"></div>
  </div>
  <div id="main">
    <div id="graph-container"></div>
    <div id="toolbar">
      <button class="toolbar-btn active" id="btn-all">All</button>
      <button class="toolbar-btn" id="btn-functions">Functions</button>
      <button class="toolbar-btn" id="btn-types">Types</button>
      <button class="toolbar-btn" id="btn-files">Files</button>
    </div>
    <div id="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#4aff7a"></div> Function</div>
      <div class="legend-item"><div class="legend-dot" style="background:#c77dff"></div> Class</div>
      <div class="legend-item"><div class="legend-dot" style="background:#4a9eff"></div> Interface</div>
      <div class="legend-item"><div class="legend-dot" style="background:#ffd94a"></div> Variable</div>
      <div class="legend-item"><div class="legend-dot" style="background:#4affd9"></div> Type Alias</div>
    </div>
    <div id="detail-panel">
      <div class="detail-header">
        <div>
          <div class="result-name" id="detail-name"></div>
          <div class="result-path" id="detail-path"></div>
        </div>
        <button class="detail-close" onclick="closeDetail()">&times;</button>
      </div>
      <div class="detail-body" id="detail-body"></div>
    </div>
  </div>

  <script>
    const API = '';
    const colors = {
      'function': '#4aff7a', 'class': '#c77dff', 'interface': '#4a9eff',
      'variable': '#ffd94a', 'type_alias': '#4affd9',
    };

    let graphData = null;
    let simulation = null;
    let currentFilter = 'all';

    // Load initial data
    async function init() {
      const [statsRes, graphRes] = await Promise.all([
        fetch(API + '/api/stats').then(r => r.json()),
        fetch(API + '/api/graph').then(r => r.json()),
      ]);

      graphData = graphRes;

      // Stats
      const statsEl = document.getElementById('stats');
      const s = statsRes.stats;
      statsEl.innerHTML = [
        stat(s.files, 'Files'), stat(s.symbols, 'Symbols'),
        stat(s.exported, 'Exported'), stat(s.edges, 'Edges'),
      ].join('');

      // Show hub symbols in sidebar
      showHubSymbols(statsRes.hubSymbols);

      // Render graph
      renderGraph(graphRes);
    }

    function stat(val, label) {
      return '<div class="stat-item"><span class="stat-value">' + val + '</span><span class="stat-label">' + label + '</span></div>';
    }

    function showHubSymbols(symbols) {
      const el = document.getElementById('results');
      el.innerHTML = symbols.map(s =>
        '<div class="result-item" onclick="showSymbol(\\'' + escapeHtml(s.name) + '\\')">' +
        '<span class="result-name">' + escapeHtml(s.name) + '</span>' +
        '<span class="result-type type-' + s.type + '">' + s.type + '</span>' +
        '<div class="result-path">' + shortPath(s.path) + ' &mdash; ' + s.connections + ' connections</div>' +
        '</div>'
      ).join('');
    }

    // Search
    let searchTimeout;
    document.getElementById('search-box').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const q = e.target.value.trim();
      if (!q) {
        fetch(API + '/api/stats').then(r => r.json()).then(d => showHubSymbols(d.hubSymbols));
        return;
      }
      searchTimeout = setTimeout(async () => {
        const results = await fetch(API + '/api/search?q=' + encodeURIComponent(q) + '&limit=30').then(r => r.json());
        const el = document.getElementById('results');
        el.innerHTML = results.map(r =>
          '<div class="result-item" onclick="showSymbol(\\'' + escapeHtml(r.name) + '\\')">' +
          '<span class="result-name">' + escapeHtml(r.name) + '</span>' +
          '<span class="result-type type-' + r.type + '">' + r.type + '</span>' +
          '<div class="result-path">' + shortPath(r.path) + '</div>' +
          '<div class="result-sig">' + escapeHtml(r.signature) + '</div>' +
          '</div>'
        ).join('');
      }, 200);
    });

    // Symbol detail
    async function showSymbol(name) {
      const data = await fetch(API + '/api/symbol/' + encodeURIComponent(name)).then(r => r.json());
      if (!data.symbol) return;

      const panel = document.getElementById('detail-panel');
      document.getElementById('detail-name').textContent = data.symbol.name;
      document.getElementById('detail-path').textContent = shortPath(data.symbol.path);

      let html = '';
      html += '<div class="detail-section"><h3>Signature</h3>';
      html += '<div class="detail-code">' + escapeHtml(data.symbol.signature) + '</div></div>';

      html += '<div class="detail-section"><h3>Source</h3>';
      html += '<div class="detail-code">' + escapeHtml(data.symbol.body) + '</div></div>';

      if (data.dependencies.length > 0) {
        html += '<div class="detail-section"><h3>Dependencies (' + data.dependencies.length + ')</h3>';
        html += data.dependencies.map(d =>
          '<div class="dep-item" onclick="showSymbol(\\'' + escapeHtml(d.name) + '\\')">' +
          '<span class="dep-name">' + escapeHtml(d.name) + '</span> ' +
          '<span class="result-type type-' + d.type + '">' + d.type + '</span><br>' +
          '<span class="dep-path">' + shortPath(d.path) + '</span></div>'
        ).join('');
        html += '</div>';
      }

      if (data.dependents.length > 0) {
        html += '<div class="detail-section"><h3>Dependents (' + data.dependents.length + ')</h3>';
        html += data.dependents.map(d =>
          '<div class="dep-item" onclick="showSymbol(\\'' + escapeHtml(d.name) + '\\')">' +
          '<span class="dep-name">' + escapeHtml(d.name) + '</span> ' +
          '<span class="result-type type-' + d.type + '">' + d.type + '</span><br>' +
          '<span class="dep-path">' + shortPath(d.path) + '</span></div>'
        ).join('');
        html += '</div>';
      }

      document.getElementById('detail-body').innerHTML = html;
      panel.classList.add('visible');

      // Highlight in graph
      highlightNode(name);
    }

    function closeDetail() {
      document.getElementById('detail-panel').classList.remove('visible');
      unhighlightAll();
    }

    // Graph rendering
    function renderGraph(data) {
      const container = document.getElementById('graph-container');
      const width = container.clientWidth;
      const height = container.clientHeight;

      d3.select('#graph-container svg').remove();

      const svg = d3.select('#graph-container').append('svg')
        .attr('width', width).attr('height', height);

      const g = svg.append('g');

      // Zoom
      svg.call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => {
        g.attr('transform', e.transform);
      }));

      // Filter nodes by connection count (show top nodes for performance)
      let nodes = data.nodes.filter(n => n.connections > 0);
      if (nodes.length > 150) {
        nodes = nodes.sort((a, b) => b.connections - a.connections).slice(0, 150);
      }
      const nodeIds = new Set(nodes.map(n => n.id));
      const edges = data.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

      simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(d => d.id).distance(80))
        .force('charge', d3.forceManyBody().strength(-120))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => Math.sqrt(d.connections) * 3 + 8));

      const link = g.append('g').selectAll('line')
        .data(edges).join('line')
        .attr('class', 'link')
        .attr('stroke', '#333')
        .attr('stroke-width', 0.5);

      const node = g.append('g').selectAll('g')
        .data(nodes).join('g')
        .attr('class', 'node')
        .call(d3.drag()
          .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
        );

      node.append('circle')
        .attr('r', d => Math.sqrt(d.connections) * 2 + 4)
        .attr('fill', d => colors[d.type] || '#666')
        .attr('stroke', d => colors[d.type] || '#666')
        .attr('fill-opacity', 0.2)
        .on('click', (e, d) => showSymbol(d.name));

      node.append('text')
        .text(d => d.name)
        .attr('dx', d => Math.sqrt(d.connections) * 2 + 8)
        .attr('dy', 4)
        .style('font-size', d => d.connections > 10 ? '12px' : '10px')
        .style('fill', d => d.connections > 10 ? '#ccc' : '#666');

      simulation.on('tick', () => {
        link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
      });
    }

    function highlightNode(name) {
      d3.selectAll('.node circle').attr('fill-opacity', d => d.name === name ? 0.8 : 0.1);
      d3.selectAll('.node text').style('fill', d => d.name === name ? '#fff' : '#333');
    }

    function unhighlightAll() {
      d3.selectAll('.node circle').attr('fill-opacity', 0.2);
      d3.selectAll('.node text').style('fill', d => d.connections > 10 ? '#ccc' : '#666');
    }

    // Filter buttons
    document.querySelectorAll('.toolbar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.id.replace('btn-', '');
        if (graphData) {
          const filtered = { ...graphData };
          if (currentFilter !== 'all') {
            const typeMap = {
              'functions': ['function'],
              'types': ['interface', 'type_alias', 'class'],
              'files': null, // show all as file-level
            };
            const types = typeMap[currentFilter];
            if (types) {
              filtered.nodes = graphData.nodes.filter(n => types.includes(n.type));
              const ids = new Set(filtered.nodes.map(n => n.id));
              filtered.edges = graphData.edges.filter(e => ids.has(e.source) && ids.has(e.target));
            }
          }
          renderGraph(filtered);
        }
      });
    });

    function shortPath(p) {
      const parts = p.split('/');
      const srcIdx = parts.indexOf('src');
      return srcIdx >= 0 ? parts.slice(srcIdx).join('/') : parts.slice(-3).join('/');
    }

    function escapeHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    init();
  </script>
</body>
</html>`;
}
