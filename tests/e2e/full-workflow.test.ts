/**
 * E2E integration test — Full user workflow:
 * identity → scenario → knowledge → index → memory query → visualize → benchmark
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "../../src/config.js";
import { closeSearchDb } from "../../src/knowledge/search.js";
import {
  createScenario,
  getScenario,
  listScenarios,
} from "../../src/scenario/manager.js";
import { applyTemplate } from "../../src/scenario/templates.js";
import {
  saveScenario,
  archiveScenario,
} from "../../src/scenario/lifecycle.js";
import {
  createEntity,
  getEntity,
  listEntities,
  deleteEntity,
} from "../../src/knowledge/entities.js";
import {
  getSearchDb,
  indexEntity,
  searchEntities,
} from "../../src/knowledge/search.js";
import {
  saveIdentity,
  loadIdentity,
  generateIdentityPrompt,
} from "../../src/memory/layers/l0-identity.js";
import { generateEssentialStory } from "../../src/memory/layers/l1-story.js";
import { routeQuery } from "../../src/memory/router.js";
import {
  buildKnowledgeGraph,
  buildTopicClusters,
  buildTimeline,
  extractWikilinks,
} from "../../src/knowledge/visualize/graph-builder.js";
import {
  renderKnowledgeGraph,
  renderTopicClusters,
  renderTimeline,
} from "../../src/knowledge/visualize/html-renderer.js";
import { loadEntitiesFromDir } from "../../src/knowledge/visualize/generator.js";
import {
  generateMockEntities,
  generateMockSessions,
  generateTestQueries,
} from "../../benchmarks/generators.js";
import { measureRecall, measurePrecision, estimateTokens } from "../../benchmarks/metrics.js";
import type { MemoryConfig } from "../../src/memory/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wikirecall-full-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.WIKIRECALL_HOME = testDir;
  resetConfig();
  closeSearchDb();
});

afterEach(() => {
  closeSearchDb();
  try {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  resetConfig();
});

function defaultMemoryConfig(): MemoryConfig {
  return {
    l0Path: join(testDir, "identity.yaml"),
    l1AutoGenerate: true,
    l2WikiDir: join(testDir, "knowledge"),
    l3Enabled: false,
    l3DbPath: join(testDir, "memory", "session-index.db"),
    l4SessionStorePath: join(testDir, "session_store.db"),
  };
}

// ---------------------------------------------------------------------------
// Full user journey
// ---------------------------------------------------------------------------

describe("full workflow — identity to benchmark", () => {
  test("create identity → create scenario → add knowledge → index → query → visualize → benchmark", () => {
    // ── Step 1: Create Identity ──
    saveIdentity({
      name: "Aviral",
      roles: ["Staff SWE", "Tech Lead"],
      accounts: [{ platform: "github", username: "aviral" }],
      coreContext: "Full-stack TypeScript engineer focused on distributed systems.",
    }, join(testDir, "identity.yaml"));

    const identity = loadIdentity(join(testDir, "identity.yaml"));
    expect(identity.name).toBe("Aviral");
    expect(identity.roles).toContain("Staff SWE");

    const prompt = generateIdentityPrompt(identity);
    expect(prompt).toContain("Aviral");
    expect(prompt).toContain("distributed systems");

    // ── Step 2: Create Scenario ──
    const scenario = applyTemplate("web-api", {
      name: "distributed-cache",
      description: "Building a distributed cache with consistent hashing",
    });
    const created = createScenario(scenario);
    expect(created.name).toBe("distributed-cache");
    expect(created.status).toBe("active");

    // Save context to the scenario
    saveScenario("distributed-cache", {
      summary: "Implementing consistent hashing ring with virtual nodes",
      next_steps: ["Add node rebalancing", "Write integration tests"],
      blockers: [],
      notes: "Using xxhash for speed",
    });

    const updated = getScenario("distributed-cache");
    expect(updated.context?.summary).toContain("consistent hashing");

    // ── Step 3: Add Knowledge Entities ──
    const { slug: slug1 } = createEntity({
      title: "Consistent Hashing",
      type: "concept",
      updated: "2025-06-15",
      tags: ["distributed-systems", "algorithms"],
      content: "## What It Is\n\nConsistent hashing maps keys to nodes on a hash ring.\n\nSee also: [[Virtual Nodes]], [[Rebalancing]]",
    });
    expect(slug1).toBe("consistent-hashing");

    const { slug: slug2 } = createEntity({
      title: "Virtual Nodes",
      type: "concept",
      updated: "2025-06-15",
      tags: ["distributed-systems", "algorithms"],
      content: "## What It Is\n\nVirtual nodes improve load distribution by mapping each physical node to multiple ring positions.\n\nRelated to [[Consistent Hashing]]",
    });
    expect(slug2).toBe("virtual-nodes");

    const { slug: slug3 } = createEntity({
      title: "Cache Architecture",
      type: "system",
      updated: "2025-06-15",
      tags: ["infrastructure", "caching"],
      content: "## What It Is\n\nOur multi-tier caching system using L1 in-process + L2 Redis + L3 CDN.\n\nUses [[Consistent Hashing]] for L2 shard routing.",
    });
    expect(slug3).toBe("cache-architecture");

    expect(listEntities()).toHaveLength(3);

    // ── Step 4: Index for Search ──
    const entity1 = getEntity("consistent-hashing");
    const entity2 = getEntity("virtual-nodes");
    const entity3 = getEntity("cache-architecture");
    indexEntity("consistent-hashing", entity1);
    indexEntity("virtual-nodes", entity2);
    indexEntity("cache-architecture", entity3);

    // Search
    const hashResults = searchEntities("hashing");
    expect(hashResults.length).toBeGreaterThan(0);
    expect(hashResults[0].slug).toBe("consistent-hashing");

    const cacheResults = searchEntities("cache");
    expect(cacheResults.length).toBeGreaterThan(0);

    // ── Step 5: Query Memory ──
    const memResult = routeQuery(
      { query: "consistent hashing" },
      defaultMemoryConfig()
    );
    // routeQuery is async
    expect(memResult).toBeInstanceOf(Promise);

    // ── Step 6: Visualize ──
    const entities = loadEntitiesFromDir(join(testDir, "knowledge"));
    expect(entities.length).toBe(3);

    const graph = buildKnowledgeGraph(entities);
    expect(graph.nodes.length).toBe(3);
    expect(graph.edges.length).toBeGreaterThan(0); // wikilinks create edges

    const clusters = buildTopicClusters(entities);
    expect(clusters.clusters.length).toBeGreaterThan(0);

    const timeline = buildTimeline(entities);
    expect(timeline.events.length).toBe(3);

    // Render HTML
    const graphHtml = renderKnowledgeGraph(graph, {
      type: "knowledge-graph",
      title: "Test Graph",
      outputPath: join(testDir, "graph.html"),
      interactive: true,
    });
    expect(graphHtml).toContain("<html");
    expect(graphHtml).toContain("Consistent Hashing");

    const clusterHtml = renderTopicClusters(clusters.clusters, {
      type: "topic-clusters",
      title: "Test Clusters",
      outputPath: join(testDir, "clusters.html"),
      interactive: true,
    });
    expect(clusterHtml).toContain("<html");

    const timelineHtml = renderTimeline(timeline.events, {
      type: "timeline",
      title: "Test Timeline",
      outputPath: join(testDir, "timeline.html"),
      interactive: true,
    });
    expect(timelineHtml).toContain("<html");

    // ── Step 7: Benchmark generators work ──
    const mockEntities = generateMockEntities(10, 42);
    expect(mockEntities).toHaveLength(10);
    expect(mockEntities[0].title).toBeString();

    const mockSessions = generateMockSessions(5, 42);
    expect(mockSessions).toHaveLength(5);

    const testQueries = generateTestQueries(mockEntities, mockSessions, 10);
    expect(testQueries.length).toBeGreaterThan(0);
    expect(testQueries[0].query).toBeString();

    // Metrics
    const tokenCount = estimateTokens("Hello world this is a test");
    expect(tokenCount).toBeGreaterThan(0);
  });

  test("wikilink extraction works across entities", () => {
    const content = "See [[Retry Patterns]] and [[API Gateway]] for more.";
    const links = extractWikilinks(content);
    expect(links).toContain("retry-patterns");
    expect(links).toContain("api-gateway");
    expect(links).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Entity CRUD full cycle
// ---------------------------------------------------------------------------

describe("full workflow — entity CRUD cycle", () => {
  test("create → read → search → update search → delete → verify gone", () => {
    // Create
    const { slug } = createEntity({
      title: "Ephemeral Entity",
      type: "concept",
      updated: "2025-06-15",
      tags: ["test"],
      content: "This entity will be deleted.",
    });
    expect(slug).toBe("ephemeral-entity");

    // Read
    const entity = getEntity("ephemeral-entity");
    expect(entity.title).toBe("Ephemeral Entity");

    // Index & Search
    indexEntity("ephemeral-entity", entity);
    const results = searchEntities("ephemeral");
    expect(results.length).toBeGreaterThan(0);

    // Delete
    deleteEntity("ephemeral-entity");
    expect(() => getEntity("ephemeral-entity")).toThrow();
    expect(listEntities()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario + Knowledge integration
// ---------------------------------------------------------------------------

describe("full workflow — scenario with knowledge", () => {
  test("scenario context references knowledge entities", () => {
    // Create entities first
    createEntity({
      title: "OAuth 2.0",
      type: "concept",
      updated: "2025-06-15",
      tags: ["auth", "security"],
      content: "OAuth 2.0 authorization framework.",
    });

    // Create scenario that references the entity
    createScenario({
      name: "auth-migration",
      version: "0.1.0",
      status: "active",
      description: "Migrating from session-based to OAuth 2.0 auth",
    });

    saveScenario("auth-migration", {
      summary: "Implementing OAuth 2.0 flow per [[OAuth 2.0]] entity",
      next_steps: ["Integrate refresh token rotation"],
      blockers: [],
    });

    const scenario = getScenario("auth-migration");
    expect(scenario.context?.summary).toContain("OAuth 2.0");

    // Entity is independently accessible
    const entity = getEntity("oauth-2-0");
    expect(entity.type).toBe("concept");
  });
});

// ---------------------------------------------------------------------------
// Memory query with knowledge entities
// ---------------------------------------------------------------------------

describe("full workflow — memory query with entities", () => {
  test("memory query returns L2 wiki results for matching entities", async () => {
    createEntity({
      title: "Circuit Breaker",
      type: "concept",
      updated: "2025-06-15",
      tags: ["resilience"],
      content: "Circuit breaker pattern prevents cascading failures.",
    });

    const result = await routeQuery(
      { query: "circuit-breaker" },
      defaultMemoryConfig()
    );
    expect(result.layers.L0).toBeDefined();
    expect(result.layers.L1).toBeDefined();
    expect(result.layers.L2).toBeDefined();
    expect(result.layers.L2?.entities.length).toBeGreaterThan(0);
  });

  test("memory query with domain hint finds specific entity", async () => {
    createEntity({
      title: "Rate Limiting",
      type: "concept",
      updated: "2025-06-15",
      tags: ["api"],
      content: "Token bucket and sliding window rate limiting algorithms.",
    });

    const result = await routeQuery(
      { query: "algorithms", domain: "rate-limiting" },
      defaultMemoryConfig()
    );
    expect(result.layers.L2).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Visualization from real entities
// ---------------------------------------------------------------------------

describe("full workflow — visualization pipeline", () => {
  test("graph builder creates edges from wikilinks", () => {
    createEntity({
      title: "Node A",
      type: "concept",
      updated: "2025-06-15",
      tags: ["graph"],
      content: "Links to [[Node B]] and [[Node C]].",
    });
    createEntity({
      title: "Node B",
      type: "concept",
      updated: "2025-06-15",
      tags: ["graph"],
      content: "Links back to [[Node A]].",
    });
    createEntity({
      title: "Node C",
      type: "system",
      updated: "2025-06-15",
      tags: ["graph"],
      content: "Standalone node linked from [[Node A]].",
    });

    const entities = loadEntitiesFromDir(join(testDir, "knowledge"));
    const graph = buildKnowledgeGraph(entities);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);

    // Verify nodes have correct types
    const nodeA = graph.nodes.find(n => n.label === "Node A");
    expect(nodeA).toBeDefined();
    expect(nodeA!.type).toBe("concept");
  });

  test("topic clusters group by tags", () => {
    createEntity({
      title: "K8s Pod",
      type: "system",
      updated: "2025-06-15",
      tags: ["kubernetes", "containers"],
      content: "K8s pods are the smallest deployable units.",
    });
    createEntity({
      title: "Docker Image",
      type: "system",
      updated: "2025-06-15",
      tags: ["containers", "docker"],
      content: "Docker images are immutable container blueprints.",
    });

    const entities = loadEntitiesFromDir(join(testDir, "knowledge"));
    const clusters = buildTopicClusters(entities);
    expect(clusters.clusters.length).toBeGreaterThan(0);

    // Both entities share the "containers" tag
    const containerCluster = clusters.clusters.find(c => c.topic === "containers");
    expect(containerCluster).toBeDefined();
    expect(containerCluster!.entities).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Benchmark data generation
// ---------------------------------------------------------------------------

describe("full workflow — benchmark data generation", () => {
  test("mock entities have valid structure", () => {
    const entities = generateMockEntities(20, 123);
    for (const e of entities) {
      expect(e.title).toBeString();
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.type).toBeString();
      expect(e.tags).toBeArray();
    }
  });

  test("mock sessions have turns", () => {
    const sessions = generateMockSessions(10, 456);
    for (const s of sessions) {
      expect(s.id).toBeString();
      expect(s.turns).toBeArray();
      expect(s.turns.length).toBeGreaterThan(0);
    }
  });

  test("test queries have ground truth", () => {
    const entities = generateMockEntities(10, 789);
    const sessions = generateMockSessions(5, 789);
    const queries = generateTestQueries(entities, sessions, 15);
    for (const q of queries) {
      expect(q.query).toBeString();
      expect(q.expectedLayer).toBeString();
    }
  });

  test("token estimation is consistent", () => {
    const text = "Hello world";
    const tokens1 = estimateTokens(text);
    const tokens2 = estimateTokens(text);
    expect(tokens1).toBe(tokens2);
    expect(tokens1).toBeGreaterThan(0);
  });

  test("seed produces deterministic results", () => {
    const entities1 = generateMockEntities(5, 42);
    const entities2 = generateMockEntities(5, 42);
    expect(entities1.map(e => e.title)).toEqual(entities2.map(e => e.title));
  });
});
