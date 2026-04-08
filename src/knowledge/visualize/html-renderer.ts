/**
 * HTML Renderer — generate self-contained interactive HTML visualizations.
 *
 * Each render function produces a complete HTML string with inline CSS/JS.
 * vis.js is loaded from CDN for network graph rendering. All other
 * interactivity is vanilla JS — zero build step required.
 */

import type {
  KnowledgeGraph,
  TopicCluster,
  TimelineEvent,
  VisualizationConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIS_CDN = "https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js";

// ---------------------------------------------------------------------------
// Shared styles — dark theme
// ---------------------------------------------------------------------------

function baseStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    .header {
      background: #1e293b;
      border-bottom: 1px solid #334155;
      padding: 1rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #f8fafc;
    }
    .header .stats {
      display: flex;
      gap: 1.5rem;
      font-size: 0.875rem;
      color: #94a3b8;
    }
    .header .stats .stat-value {
      color: #6366f1;
      font-weight: 600;
    }
    .container { padding: 1.5rem 2rem; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.5rem;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .card h3 { color: #f8fafc; margin-bottom: 0.5rem; }
    .card p { color: #94a3b8; font-size: 0.875rem; }
    .tag {
      display: inline-block;
      background: #334155;
      color: #cbd5e1;
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      margin: 0.125rem;
    }
    .type-badge {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .sidebar {
      position: fixed;
      right: 0;
      top: 0;
      width: 350px;
      height: 100vh;
      background: #1e293b;
      border-left: 1px solid #334155;
      padding: 1.5rem;
      overflow-y: auto;
      transform: translateX(100%);
      transition: transform 0.3s ease;
      z-index: 100;
    }
    .sidebar.open { transform: translateX(0); }
    .sidebar .close-btn {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 1.5rem;
      cursor: pointer;
    }
    .sidebar h2 { color: #f8fafc; margin-bottom: 1rem; font-size: 1.25rem; }
    .sidebar .detail-row {
      margin-bottom: 0.75rem;
    }
    .sidebar .detail-label {
      color: #64748b;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .sidebar .detail-value {
      color: #e2e8f0;
      font-size: 0.875rem;
    }
    .filter-bar {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    .filter-btn {
      background: #334155;
      border: 1px solid #475569;
      color: #cbd5e1;
      padding: 0.375rem 0.75rem;
      border-radius: 0.375rem;
      cursor: pointer;
      font-size: 0.8125rem;
      transition: all 0.2s;
    }
    .filter-btn:hover { background: #475569; }
    .filter-btn.active {
      background: #6366f1;
      border-color: #6366f1;
      color: #fff;
    }
    .search-input {
      background: #0f172a;
      border: 1px solid #334155;
      color: #e2e8f0;
      padding: 0.5rem 0.75rem;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      width: 250px;
    }
    .search-input::placeholder { color: #64748b; }
    #graph-container {
      width: 100%;
      height: calc(100vh - 180px);
      border: 1px solid #334155;
      border-radius: 0.5rem;
      background: #0f172a;
    }
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid #334155;
      margin-bottom: 1.5rem;
    }
    .tab {
      padding: 0.75rem 1.5rem;
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 0.875rem;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .tab:hover { color: #e2e8f0; }
    .tab.active {
      color: #6366f1;
      border-bottom-color: #6366f1;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .cluster-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
    }
    .cluster-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.5rem;
      padding: 1.25rem;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .cluster-card:hover { border-color: #6366f1; }
    .cluster-card h3 {
      color: #f8fafc;
      margin-bottom: 0.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .cluster-count {
      background: #6366f1;
      color: #fff;
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.75rem;
    }
    .cluster-entities {
      display: none;
      margin-top: 0.75rem;
      border-top: 1px solid #334155;
      padding-top: 0.75rem;
    }
    .cluster-card.expanded .cluster-entities { display: block; }
    .entity-item {
      padding: 0.375rem 0;
      border-bottom: 1px solid #1e293b;
      font-size: 0.875rem;
    }
    .entity-item:last-child { border-bottom: none; }
    .timeline-container {
      position: relative;
      padding-left: 2rem;
    }
    .timeline-line {
      position: absolute;
      left: 0.5rem;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #334155;
    }
    .timeline-event {
      position: relative;
      margin-bottom: 1.5rem;
      padding-left: 1rem;
    }
    .timeline-dot {
      position: absolute;
      left: -1.625rem;
      top: 0.375rem;
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      background: #6366f1;
      border: 2px solid #0f172a;
    }
    .timeline-date {
      color: #64748b;
      font-size: 0.75rem;
      margin-bottom: 0.25rem;
    }
    .timeline-title {
      color: #f8fafc;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .timeline-badge {
      display: inline-block;
      padding: 0.0625rem 0.375rem;
      border-radius: 0.25rem;
      font-size: 0.6875rem;
      font-weight: 600;
    }
    .timeline-badge.created { background: #065f46; color: #6ee7b7; }
    .timeline-badge.updated { background: #1e3a5f; color: #93c5fd; }
    .footer {
      text-align: center;
      padding: 1.5rem;
      color: #475569;
      font-size: 0.75rem;
      border-top: 1px solid #1e293b;
    }
  `;
}

// ---------------------------------------------------------------------------
// Escape helper
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------------------------------------------------------------------------
// Type colour map (inline JSON for the browser)
// ---------------------------------------------------------------------------

const TYPE_COLORS_JSON = JSON.stringify({
  concept: "#6366f1",
  tool: "#10b981",
  platform: "#f59e0b",
  system: "#ef4444",
  repo: "#3b82f6",
  person: "#ec4899",
  team: "#8b5cf6",
});

// ---------------------------------------------------------------------------
// renderKnowledgeGraph
// ---------------------------------------------------------------------------

/**
 * Render an interactive network graph using vis.js.
 * Nodes are coloured by entity type, sized by connection count.
 * Clicking a node opens a sidebar with entity details.
 */
export function renderKnowledgeGraph(
  graph: KnowledgeGraph,
  config: VisualizationConfig,
): string {
  const nodesJson = JSON.stringify(
    graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      value: n.size,
      color: (n.metadata.color as string) ?? "#94a3b8",
      title: `${n.label} (${n.type})`,
      group: n.type,
      font: { color: "#e2e8f0", size: 12 },
      metadata: n.metadata,
      type: n.type,
    })),
  );

  const edgesJson = JSON.stringify(
    graph.edges.map((e) => ({
      from: e.source,
      to: e.target,
      label: e.weight > 1 ? String(e.weight) : "",
      value: e.weight,
      color: { color: "#475569", highlight: "#6366f1" },
      font: { color: "#64748b", size: 10 },
    })),
  );

  const entityTypes = [...new Set(graph.nodes.map((n) => n.type))].sort();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(config.title)}</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(config.title)}</h1>
    <div class="stats">
      <span><span class="stat-value">${graph.nodes.length}</span> entities</span>
      <span><span class="stat-value">${graph.edges.length}</span> connections</span>
    </div>
  </div>
  <div class="container">
    <div class="filter-bar">
      <input type="text" class="search-input" id="searchInput" placeholder="Search entities…" />
      <button class="filter-btn active" data-type="all">All</button>
      ${entityTypes.map((t) => `<button class="filter-btn" data-type="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("\n      ")}
    </div>
    <div id="graph-container"></div>
  </div>

  <div class="sidebar" id="sidebar">
    <button class="close-btn" onclick="closeSidebar()">&times;</button>
    <h2 id="sidebar-title"></h2>
    <div id="sidebar-content"></div>
  </div>

  <div class="footer">Generated by WikiRecall — ${new Date().toISOString().slice(0, 10)}</div>

  <script src="${VIS_CDN}"></script>
  <script>
    const TYPE_COLORS = ${TYPE_COLORS_JSON};
    const nodesData = ${nodesJson};
    const edgesData = ${edgesJson};

    const nodes = new vis.DataSet(nodesData);
    const edges = new vis.DataSet(edgesData);

    const container = document.getElementById('graph-container');
    const network = new vis.Network(container, { nodes, edges }, {
      physics: {
        barnesHut: { gravitationalConstant: -3000, springLength: 150 },
        stabilization: { iterations: 150 }
      },
      nodes: {
        shape: 'dot',
        scaling: { min: 10, max: 50 },
        borderWidth: 2,
        shadow: true
      },
      edges: {
        smooth: { type: 'continuous' },
        width: 1,
        scaling: { min: 1, max: 5 }
      },
      interaction: { hover: true, tooltipDelay: 200 }
    });

    // Click → sidebar
    network.on('click', function(params) {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        const node = nodesData.find(n => n.id === nodeId);
        if (node) showSidebar(node);
      }
    });

    function showSidebar(node) {
      document.getElementById('sidebar-title').textContent = node.label;
      const meta = node.metadata || {};
      document.getElementById('sidebar-content').innerHTML =
        '<div class="detail-row"><span class="detail-label">Type</span>' +
        '<div class="detail-value"><span class="type-badge" style="background:' +
        (TYPE_COLORS[node.type] || '#94a3b8') + '">' + node.type + '</span></div></div>' +
        '<div class="detail-row"><span class="detail-label">Updated</span>' +
        '<div class="detail-value">' + (meta.updated || 'N/A') + '</div></div>' +
        '<div class="detail-row"><span class="detail-label">Tags</span>' +
        '<div class="detail-value">' + ((meta.tags || []).map(function(t) {
          return '<span class="tag">' + t + '</span>';
        }).join(' ') || 'None') + '</div></div>' +
        '<div class="detail-row"><span class="detail-label">Related</span>' +
        '<div class="detail-value">' + ((meta.related || []).join(', ') || 'None') + '</div></div>';
      document.getElementById('sidebar').classList.add('open');
    }

    function closeSidebar() {
      document.getElementById('sidebar').classList.remove('open');
    }

    // Filter by type
    document.querySelectorAll('.filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var type = btn.dataset.type;
        if (type === 'all') {
          nodes.update(nodesData.map(function(n) { return { id: n.id, hidden: false }; }));
        } else {
          nodes.update(nodesData.map(function(n) {
            return { id: n.id, hidden: n.type !== type };
          }));
        }
      });
    });

    // Search filter
    document.getElementById('searchInput').addEventListener('input', function(e) {
      var q = e.target.value.toLowerCase();
      nodes.update(nodesData.map(function(n) {
        return { id: n.id, hidden: q.length > 0 && n.label.toLowerCase().indexOf(q) === -1 };
      }));
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// renderTopicClusters
// ---------------------------------------------------------------------------

/**
 * Render a grouped card layout with entity counts per cluster.
 * Clicking a cluster card expands it to show the entities.
 */
export function renderTopicClusters(
  clusters: TopicCluster[],
  config: VisualizationConfig,
): string {
  const totalEntities = new Set(clusters.flatMap((c) => c.entities.map((e) => e.title))).size;

  const clusterCards = clusters
    .map(
      (c) => `
      <div class="cluster-card" onclick="this.classList.toggle('expanded')">
        <h3>
          <span>${escapeHtml(c.topic)}</span>
          <span class="cluster-count">${c.entities.length}</span>
        </h3>
        <p class="cluster-desc">${c.entities.length} entit${c.entities.length === 1 ? "y" : "ies"}</p>
        <div class="cluster-entities">
          ${c.entities
            .map(
              (e) =>
                `<div class="entity-item">
                  <span>${escapeHtml(e.title)}</span>
                  <span class="type-badge" style="background: ${escapeHtml(getTypeColorInline(e.type))}">${escapeHtml(e.type)}</span>
                </div>`,
            )
            .join("")}
        </div>
      </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(config.title)}</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(config.title)}</h1>
    <div class="stats">
      <span><span class="stat-value">${totalEntities}</span> entities</span>
      <span><span class="stat-value">${clusters.length}</span> clusters</span>
    </div>
  </div>
  <div class="container">
    <div class="cluster-grid">
      ${clusterCards}
    </div>
  </div>
  <div class="footer">Generated by WikiRecall — ${new Date().toISOString().slice(0, 10)}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// renderTimeline
// ---------------------------------------------------------------------------

/**
 * Render a chronological timeline of knowledge entity events.
 */
export function renderTimeline(
  events: TimelineEvent[],
  config: VisualizationConfig,
): string {
  const timelineItems = events
    .map(
      (ev) => `
      <div class="timeline-event">
        <div class="timeline-dot"></div>
        <div class="timeline-date">${escapeHtml(ev.date)}</div>
        <div class="timeline-title">${escapeHtml(ev.entity.title)}</div>
        <span class="timeline-badge ${ev.event}">${escapeHtml(ev.event)}</span>
        <span class="type-badge" style="background: ${escapeHtml(getTypeColorInline(ev.entity.type))}">${escapeHtml(ev.entity.type)}</span>
      </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(config.title)}</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(config.title)}</h1>
    <div class="stats">
      <span><span class="stat-value">${events.length}</span> events</span>
    </div>
  </div>
  <div class="container">
    <div class="timeline-container">
      <div class="timeline-line"></div>
      ${timelineItems}
    </div>
  </div>
  <div class="footer">Generated by WikiRecall — ${new Date().toISOString().slice(0, 10)}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// renderResearchLandscape
// ---------------------------------------------------------------------------

/**
 * Combined dashboard: graph + clusters + stats with tabbed navigation.
 */
export function renderResearchLandscape(
  graph: KnowledgeGraph,
  clusters: TopicCluster[],
  config: VisualizationConfig,
): string {
  const entityTypes = [...new Set(graph.nodes.map((n) => n.type))].sort();
  const typeBreakdown = entityTypes
    .map((t) => {
      const count = graph.nodes.filter((n) => n.type === t).length;
      return `<span><span class="type-badge" style="background: ${escapeHtml(getTypeColorInline(t))}">${escapeHtml(t)}</span> <span class="stat-value">${count}</span></span>`;
    })
    .join(" ");

  const nodesJson = JSON.stringify(
    graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      value: n.size,
      color: (n.metadata.color as string) ?? "#94a3b8",
      group: n.type,
      type: n.type,
      font: { color: "#e2e8f0", size: 12 },
      metadata: n.metadata,
    })),
  );

  const edgesJson = JSON.stringify(
    graph.edges.map((e) => ({
      from: e.source,
      to: e.target,
      value: e.weight,
      color: { color: "#475569", highlight: "#6366f1" },
    })),
  );

  const clusterCards = clusters
    .map(
      (c) => `
      <div class="cluster-card" onclick="this.classList.toggle('expanded')">
        <h3>
          <span>${escapeHtml(c.topic)}</span>
          <span class="cluster-count">${c.entities.length}</span>
        </h3>
        <div class="cluster-entities">
          ${c.entities.map((e) => `<div class="entity-item">${escapeHtml(e.title)}</div>`).join("")}
        </div>
      </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(config.title)}</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(config.title)}</h1>
    <div class="stats">
      <span><span class="stat-value">${graph.nodes.length}</span> entities</span>
      <span><span class="stat-value">${graph.edges.length}</span> connections</span>
      <span><span class="stat-value">${clusters.length}</span> clusters</span>
    </div>
  </div>

  <div class="container">
    <div style="margin-bottom: 1rem;">${typeBreakdown}</div>

    <div class="tabs">
      <button class="tab active" data-tab="graph">Knowledge Graph</button>
      <button class="tab" data-tab="clusters">Topic Clusters</button>
    </div>

    <div class="tab-content active" id="tab-graph">
      <div class="filter-bar">
        <input type="text" class="search-input" id="searchInput" placeholder="Search entities…" />
      </div>
      <div id="graph-container"></div>
    </div>

    <div class="tab-content" id="tab-clusters">
      <div class="cluster-grid">
        ${clusterCards}
      </div>
    </div>
  </div>

  <div class="sidebar" id="sidebar">
    <button class="close-btn" onclick="closeSidebar()">&times;</button>
    <h2 id="sidebar-title"></h2>
    <div id="sidebar-content"></div>
  </div>

  <div class="footer">Generated by WikiRecall — ${new Date().toISOString().slice(0, 10)}</div>

  <script src="${VIS_CDN}"></script>
  <script>
    var TYPE_COLORS = ${TYPE_COLORS_JSON};
    var nodesData = ${nodesJson};
    var edgesData = ${edgesJson};
    var nodes = new vis.DataSet(nodesData);
    var edges = new vis.DataSet(edgesData);

    // Tabs
    document.querySelectorAll('.tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'graph' && network) network.fit();
      });
    });

    var container = document.getElementById('graph-container');
    var network = new vis.Network(container, { nodes: nodes, edges: edges }, {
      physics: {
        barnesHut: { gravitationalConstant: -3000, springLength: 150 },
        stabilization: { iterations: 150 }
      },
      nodes: { shape: 'dot', scaling: { min: 10, max: 50 }, borderWidth: 2, shadow: true },
      edges: { smooth: { type: 'continuous' }, width: 1 },
      interaction: { hover: true }
    });

    network.on('click', function(params) {
      if (params.nodes.length > 0) {
        var node = nodesData.find(function(n) { return n.id === params.nodes[0]; });
        if (node) showSidebar(node);
      }
    });

    function showSidebar(node) {
      var meta = node.metadata || {};
      document.getElementById('sidebar-title').textContent = node.label;
      document.getElementById('sidebar-content').innerHTML =
        '<div class="detail-row"><span class="detail-label">Type</span>' +
        '<div class="detail-value"><span class="type-badge" style="background:' +
        (TYPE_COLORS[node.type] || '#94a3b8') + '">' + node.type + '</span></div></div>' +
        '<div class="detail-row"><span class="detail-label">Updated</span>' +
        '<div class="detail-value">' + (meta.updated || 'N/A') + '</div></div>' +
        '<div class="detail-row"><span class="detail-label">Tags</span>' +
        '<div class="detail-value">' + ((meta.tags || []).map(function(t) {
          return '<span class="tag">' + t + '</span>';
        }).join(' ') || 'None') + '</div></div>';
      document.getElementById('sidebar').classList.add('open');
    }

    function closeSidebar() {
      document.getElementById('sidebar').classList.remove('open');
    }

    document.getElementById('searchInput').addEventListener('input', function(e) {
      var q = e.target.value.toLowerCase();
      nodes.update(nodesData.map(function(n) {
        return { id: n.id, hidden: q.length > 0 && n.label.toLowerCase().indexOf(q) === -1 };
      }));
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Internal helper — get type colour for inline use (mirrors graph-builder)
// ---------------------------------------------------------------------------

function getTypeColorInline(type: string): string {
  const map: Record<string, string> = {
    concept: "#6366f1",
    tool: "#10b981",
    platform: "#f59e0b",
    system: "#ef4444",
    repo: "#3b82f6",
    person: "#ec4899",
    team: "#8b5cf6",
  };
  return map[type] ?? "#94a3b8";
}
