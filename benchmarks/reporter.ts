/**
 * Benchmark Reporter — generates markdown and HTML reports from benchmark results.
 *
 * Produces readable tables, summaries, and interactive HTML charts.
 */

import type { BenchmarkSuite, BenchmarkResult } from "./types.js";

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

/**
 * Generate a comprehensive Markdown report from benchmark suites.
 */
export function generateMarkdownReport(suites: BenchmarkSuite[]): string {
  const lines: string[] = [];

  lines.push("# WikiRecall Memory Architecture — Benchmark Results");
  lines.push("");
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push("");

  // Executive summary
  lines.push("## Executive Summary");
  lines.push("");
  for (const suite of suites) {
    lines.push(`- **${suite.name}**: ${suite.summary}`);
  }
  lines.push("");

  // Detailed results per suite
  for (const suite of suites) {
    lines.push(`## ${titleCase(suite.name)}`);
    lines.push("");
    lines.push(`*${suite.description}*`);
    lines.push("");
    lines.push(`Started: ${suite.startedAt} | Completed: ${suite.completedAt}`);
    lines.push("");

    // Results table
    lines.push("| Name | Metric | Value | Unit |");
    lines.push("|------|--------|------:|------|");
    for (const r of suite.results) {
      const value = typeof r.value === "number"
        ? Number.isInteger(r.value) ? String(r.value) : r.value.toFixed(2)
        : String(r.value);
      lines.push(`| ${r.name} | ${r.metric} | ${value} | ${r.unit} |`);
    }
    lines.push("");

    // Summary
    lines.push(`**Summary**: ${suite.summary}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

/**
 * Generate an interactive HTML report with charts (uses vis.js pattern).
 */
export function generateHtmlReport(suites: BenchmarkSuite[]): string {
  const suitesJson = JSON.stringify(suites, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WikiRecall Benchmark Results</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --text-muted: #8b949e;
    --accent: #58a6ff;
    --green: #3fb950;
    --yellow: #d29922;
    --red: #f85149;
    --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    padding: 2rem;
  }
  h1 { color: var(--accent); margin-bottom: 0.5rem; font-size: 1.8rem; }
  h2 { color: var(--text); margin: 2rem 0 1rem; font-size: 1.3rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
  .subtitle { color: var(--text-muted); margin-bottom: 2rem; }
  .suite {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .suite-name { font-size: 1.2rem; color: var(--accent); margin-bottom: 0.5rem; }
  .suite-desc { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem; }
  .suite-summary { color: var(--green); font-size: 0.95rem; margin-top: 1rem; padding-top: 0.5rem; border-top: 1px solid var(--border); }
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
  th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--text-muted); font-weight: 600; font-size: 0.85rem; text-transform: uppercase; }
  td { font-size: 0.9rem; }
  td.value { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--accent); }
  td.unit { color: var(--text-muted); }
  .chart-container {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    margin: 1.5rem 0;
  }
  .bar-chart { display: flex; flex-direction: column; gap: 0.5rem; }
  .bar-row { display: flex; align-items: center; gap: 0.5rem; }
  .bar-label { width: 200px; font-size: 0.85rem; color: var(--text-muted); text-align: right; }
  .bar-track { flex: 1; background: var(--border); border-radius: 4px; height: 24px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; padding-left: 8px; font-size: 0.8rem; font-weight: 600; color: var(--bg); min-width: 2px; transition: width 0.5s ease; }
  .bar-fill.green { background: var(--green); }
  .bar-fill.blue { background: var(--accent); }
  .bar-fill.purple { background: var(--purple); }
  .bar-fill.yellow { background: var(--yellow); }
  .exec-summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem; margin: 1rem 0; }
  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }
  .stat-label { font-size: 0.8rem; color: var(--text-muted); }
  .stat-value { font-size: 1.5rem; font-weight: 700; color: var(--accent); }
  .stat-unit { font-size: 0.9rem; color: var(--text-muted); }
</style>
</head>
<body>
<h1>WikiRecall Memory Architecture</h1>
<p class="subtitle">Benchmark Results &mdash; ${new Date().toISOString().split("T")[0]}</p>

<div id="app"></div>

<script>
const suites = ${suitesJson};

function renderApp() {
  const app = document.getElementById('app');
  let html = '';

  // Executive summary cards
  html += '<h2>Executive Summary</h2>';
  html += '<div class="exec-summary">';
  for (const suite of suites) {
    const keyResult = suite.results.find(r =>
      r.metric === 'accuracy' || r.metric === 'recall' || r.metric === 'token_savings_vs_baseline'
    ) || suite.results[0];
    html += '<div class="stat-card">';
    html += '<div class="stat-label">' + titleCase(suite.name) + '</div>';
    html += '<div class="stat-value">' + formatValue(keyResult.value) + ' <span class="stat-unit">' + keyResult.unit + '</span></div>';
    html += '<div class="stat-label">' + keyResult.metric + '</div>';
    html += '</div>';
  }
  html += '</div>';

  // Detail per suite
  for (const suite of suites) {
    html += '<div class="suite">';
    html += '<div class="suite-name">' + titleCase(suite.name) + '</div>';
    html += '<div class="suite-desc">' + suite.description + '</div>';

    // Bar chart for % metrics
    const percentResults = suite.results.filter(r => r.unit === '%');
    if (percentResults.length > 0) {
      html += '<div class="chart-container"><div class="bar-chart">';
      const maxVal = Math.max(...percentResults.map(r => r.value), 100);
      for (const r of percentResults) {
        const pct = (r.value / maxVal) * 100;
        const color = r.value >= 90 ? 'green' : r.value >= 70 ? 'blue' : r.value >= 50 ? 'yellow' : 'purple';
        html += '<div class="bar-row">';
        html += '<div class="bar-label">' + r.name + ' (' + r.metric + ')</div>';
        html += '<div class="bar-track"><div class="bar-fill ' + color + '" style="width:' + pct + '%">' + formatValue(r.value) + '%</div></div>';
        html += '</div>';
      }
      html += '</div></div>';
    }

    // Results table
    html += '<table><thead><tr><th>Name</th><th>Metric</th><th>Value</th><th>Unit</th></tr></thead><tbody>';
    for (const r of suite.results) {
      html += '<tr><td>' + r.name + '</td><td>' + r.metric + '</td><td class="value">' + formatValue(r.value) + '</td><td class="unit">' + r.unit + '</td></tr>';
    }
    html += '</tbody></table>';

    html += '<div class="suite-summary">' + suite.summary + '</div>';
    html += '</div>';
  }

  app.innerHTML = html;
}

function titleCase(s) {
  return s.replace(/-/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase());
}

function formatValue(v) {
  if (typeof v !== 'number') return String(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

renderApp();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

/**
 * Print a concise summary to console using chalk.
 */
export function formatConsoleSummary(suites: BenchmarkSuite[]): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("  WikiRecall Benchmark Results");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");

  for (const suite of suites) {
    lines.push(`  ▸ ${titleCase(suite.name)}`);
    lines.push(`    ${suite.summary}`);
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════════");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
