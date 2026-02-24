/**
 * Generate the static dashboard HTML that reads from pre-exported JSON files.
 * The output is saved to public/index.html
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";

function getStaticDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeGraph — Context engine for AI coding agents</title>
  <meta name="description" content="Parse your codebase, build a dependency graph, serve structured context via MCP. 96% fewer tokens for AI agents.">
  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0a0a0a; color: #e0e0e0; height: 100vh; overflow: hidden;
      display: flex; flex-direction: column;
    }
    #hero {
      padding: 20px 24px; border-bottom: 1px solid #222; background: #0d1117;
      display: flex; align-items: center; justify-content: space-between;
    }
    #hero h1 { font-size: 20px; font-weight: 700; color: #fff; }
    #hero h1 span { color: #4aff7a; }
    #hero .tagline { font-size: 13px; color: #888; margin-top: 2px; }
    #hero .cta {
      display: flex; gap: 10px; align-items: center;
    }
    .cta-btn {
      padding: 8px 16px; border-radius: 6px; font-size: 13px; font-family: inherit;
      cursor: pointer; text-decoration: none; font-weight: 500;
    }
    .cta-primary {
      background: #4aff7a; color: #0a0a0a; border: none;
    }
    .cta-secondary {
      background: transparent; color: #4a9eff; border: 1px solid #333;
    }
    .cta-code {
      background: #1a1a2a; color: #4aff7a; border: 1px solid #333;
      font-family: 'SF Mono', monospace; padding: 8px 14px; border-radius: 6px;
      font-size: 13px; user-select: all;
    }
    #app { flex: 1; display: flex; overflow: hidden; }
    #sidebar {
      width: 380px; min-width: 380px; background: #111; border-right: 1px solid #222;
      display: flex; flex-direction: column; overflow: hidden;
    }
    #sidebar-header {
      padding: 16px; border-bottom: 1px solid #222;
    }
    #sidebar-header h2 {
      font-size: 14px; font-weight: 600; color: #ccc; margin-bottom: 8px;
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
    #savings-panel {
      padding: 12px 16px; border-bottom: 1px solid #222; background: #0d1117;
    }
    #savings-panel h2 {
      font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    .savings-hero {
      display: flex; gap: 16px; margin-bottom: 12px;
    }
    .savings-big {
      display: flex; flex-direction: column;
    }
    .savings-big .value {
      font-size: 28px; font-weight: 700; color: #4aff7a;
    }
    .savings-big .label {
      font-size: 11px; color: #666; text-transform: uppercase;
    }
    .savings-bar {
      display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px;
    }
    .savings-bar .name { width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ccc; }
    .savings-bar .bar-bg {
      flex: 1; height: 6px; background: #1a1a2a; border-radius: 3px; overflow: hidden;
    }
    .savings-bar .bar-fill {
      height: 100%; background: #4aff7a; border-radius: 3px; transition: width 0.5s;
    }
    .savings-bar .pct { width: 35px; text-align: right; color: #4aff7a; font-weight: 600; }
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
      max-height: calc(100vh - 100px); overflow-y: auto; display: none;
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
  <div id="hero">
    <div>
      <h1>Code<span>Graph</span></h1>
      <div class="tagline">Context engine for AI coding agents &mdash; 96% fewer tokens</div>
    </div>
    <div class="cta">
      <code class="cta-code">npx codegraph-ai index .</code>
      <a href="https://github.com/jotaeme/codegraph" target="_blank" class="cta-btn cta-secondary">GitHub</a>
    </div>
  </div>
  <div id="app">
    <div id="sidebar">
      <div id="sidebar-header">
        <h2>Live Demo &mdash; CodeGraph indexed on itself</h2>
        <input type="text" id="search-box" placeholder="Search symbols..." autofocus />
      </div>
      <div class="stats" id="stats"></div>
      <div id="savings-panel"></div>
      <div id="results"></div>
    </div>
    <div id="main">
      <div id="graph-container"></div>
      <div id="toolbar">
        <button class="toolbar-btn active" id="btn-all">All</button>
        <button class="toolbar-btn" id="btn-functions">Functions</button>
        <button class="toolbar-btn" id="btn-types">Types</button>
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
  </div>

  <script>
    // Static mode: fetch from .json files
    const API = '/api';
    const colors = {
      'function': '#4aff7a', 'class': '#c77dff', 'interface': '#4a9eff',
      'variable': '#ffd94a', 'type_alias': '#4affd9',
    };

    let graphData = null;
    let simulation = null;
    let currentFilter = 'all';
    let allSymbolsCache = null;

    async function init() {
      const [statsRes, graphRes, benchRes] = await Promise.all([
        fetch(API + '/stats.json').then(r => r.json()),
        fetch(API + '/graph.json').then(r => r.json()),
        fetch(API + '/benchmark.json').then(r => r.json()),
      ]);

      graphData = graphRes;

      // Stats
      const statsEl = document.getElementById('stats');
      const s = statsRes.stats;
      statsEl.innerHTML = [
        stat(s.files, 'Files'), stat(s.symbols, 'Symbols'),
        stat(s.exported, 'Exported'), stat(s.edges, 'Edges'),
      ].join('');

      // Token savings
      renderSavings(benchRes);

      // Show hub symbols
      allSymbolsCache = statsRes.hubSymbols;
      showHubSymbols(statsRes.hubSymbols);

      renderGraph(graphRes);
    }

    function stat(val, label) {
      return '<div class="stat-item"><span class="stat-value">' + val + '</span><span class="stat-label">' + label + '</span></div>';
    }

    function renderSavings(data) {
      const panel = document.getElementById('savings-panel');
      if (!data.symbols || data.symbols.length === 0) { panel.style.display = 'none'; return; }
      const t = data.total;
      let html = '<h2>Token Savings</h2>';
      html += '<div class="savings-hero">';
      html += '<div class="savings-big"><span class="value">' + t.percentSaved + '%</span><span class="label">Tokens Saved</span></div>';
      html += '<div class="savings-big"><span class="value" style="color:#ffd94a">$' + t.monthlySavings + '</span><span class="label">/month saved*</span></div>';
      html += '</div>';
      for (const sym of data.symbols) {
        html += '<div class="savings-bar">';
        html += '<span class="name" title="' + escapeHtml(sym.name) + '">' + escapeHtml(sym.name) + '</span>';
        html += '<div class="bar-bg"><div class="bar-fill" style="width:' + sym.percentSaved + '%"></div></div>';
        html += '<span class="pct">' + sym.percentSaved + '%</span>';
        html += '</div>';
      }
      html += '<div style="font-size:10px;color:#555;margin-top:8px">*At 100 ops/day, Claude Sonnet pricing</div>';
      panel.innerHTML = html;
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

    // Search: in static mode, filter from cached symbols
    let searchTimeout;
    document.getElementById('search-box').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const q = e.target.value.trim().toLowerCase();
      if (!q) {
        if (allSymbolsCache) showHubSymbols(allSymbolsCache);
        return;
      }
      searchTimeout = setTimeout(() => {
        // Filter from graph nodes
        if (graphData) {
          const results = graphData.nodes
            .filter(n => n.name.toLowerCase().includes(q))
            .sort((a, b) => b.connections - a.connections)
            .slice(0, 20);
          const el = document.getElementById('results');
          el.innerHTML = results.map(r =>
            '<div class="result-item" onclick="showSymbol(\\'' + escapeHtml(r.name) + '\\')">' +
            '<span class="result-name">' + escapeHtml(r.name) + '</span>' +
            '<span class="result-type type-' + r.type + '">' + r.type + '</span>' +
            '<div class="result-path">' + shortPath(r.path) + '</div>' +
            '</div>'
          ).join('');
        }
      }, 150);
    });

    async function showSymbol(name) {
      // Try to load pre-generated JSON, fall back gracefully
      let data;
      try {
        data = await fetch(API + '/symbol/' + encodeURIComponent(name) + '.json').then(r => {
          if (!r.ok) throw new Error('not found');
          return r.json();
        });
      } catch {
        // Symbol not pre-generated, show what we know from graph
        const node = graphData?.nodes?.find(n => n.name === name);
        if (!node) return;
        data = {
          symbol: { name: node.name, type: node.type, path: node.path, signature: '', body: '(source not available in demo)' },
          dependencies: [],
          dependents: [],
        };
      }
      if (!data.symbol) return;

      const panel = document.getElementById('detail-panel');
      document.getElementById('detail-name').textContent = data.symbol.name;
      document.getElementById('detail-path').textContent = shortPath(data.symbol.path);

      let html = '';
      if (data.symbol.signature) {
        html += '<div class="detail-section"><h3>Signature</h3>';
        html += '<div class="detail-code">' + escapeHtml(data.symbol.signature) + '</div></div>';
      }

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
      highlightNode(name);
    }

    function closeDetail() {
      document.getElementById('detail-panel').classList.remove('visible');
      unhighlightAll();
    }

    function renderGraph(data) {
      const container = document.getElementById('graph-container');
      const width = container.clientWidth;
      const height = container.clientHeight;

      d3.select('#graph-container svg').remove();

      const svg = d3.select('#graph-container').append('svg')
        .attr('width', width).attr('height', height);

      const g = svg.append('g');

      svg.call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => {
        g.attr('transform', e.transform);
      }));

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
      if (!s) return '';
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    init();
  </script>
</body>
</html>`;
}

const targetDir = resolve(process.argv[2] || ".");
const outDir = join(targetDir, "public");

import { existsSync } from "fs";
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, "index.html"), getStaticDashboardHtml());
console.log(`  public/index.html`);
