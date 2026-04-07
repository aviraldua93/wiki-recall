/**
 * Scenario Templates — pre-built scenario starters for common project types.
 *
 * Templates are loaded from YAML files in the templates/ directory and provide
 * sensible defaults for repos, skills, and context based on the project archetype.
 * Also provides in-memory template definitions for programmatic use.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { Scenario } from "../types.js";
import { createScenario, validateScenarioManifest } from "./manager.js";

// ---------------------------------------------------------------------------
// Template interface
// ---------------------------------------------------------------------------

export interface ScenarioTemplate {
  /** Template identifier. */
  id: string;
  /** Human-readable name. */
  label: string;
  /** Short description. */
  description: string;
  /** Partial scenario to merge with user inputs. */
  defaults: Partial<Scenario>;
}

// ---------------------------------------------------------------------------
// In-memory template definitions (backward compat + fallback)
// ---------------------------------------------------------------------------

const builtinTemplates: ScenarioTemplate[] = [
  {
    id: "web-api",
    label: "Web API",
    description: "REST API with auth, tests, CI",
    defaults: {
      version: "0.1.0",
      status: "active",
      skills: [
        { name: "code-review", source: "root" },
        { name: "ci-monitor", source: "root" },
        { name: "pr-management", source: "root" },
      ],
      context: {
        summary: "",
        open_prs: [],
        next_steps: [
          "Set up project structure and dependencies",
          "Implement API routes and middleware",
          "Add authentication and authorization",
          "Write integration tests",
          "Configure CI pipeline",
        ],
        blockers: [],
        notes: "",
      },
    },
  },
  {
    id: "frontend-app",
    label: "Frontend App",
    description: "React/Angular dashboard project",
    defaults: {
      version: "0.1.0",
      status: "active",
      skills: [
        { name: "code-review", source: "root" },
        { name: "ci-monitor", source: "root" },
        { name: "pr-management", source: "root" },
      ],
      context: {
        summary: "",
        open_prs: [],
        next_steps: [
          "Scaffold the frontend application",
          "Implement core UI components",
          "Set up state management",
          "Add routing and navigation",
          "Write component tests",
        ],
        blockers: [],
        notes: "",
      },
    },
  },
  {
    id: "infra-pipeline",
    label: "Infrastructure Pipeline",
    description: "CI/CD pipelines and build system",
    defaults: {
      version: "0.1.0",
      status: "active",
      skills: [
        { name: "ci-monitor", source: "root" },
        { name: "pr-management", source: "root" },
      ],
      context: {
        summary: "",
        open_prs: [],
        next_steps: [
          "Define pipeline stages and triggers",
          "Configure build and test jobs",
          "Set up deployment targets",
          "Add monitoring and alerting",
          "Document runbooks",
        ],
        blockers: [],
        notes: "",
      },
    },
  },
  {
    id: "research-paper",
    label: "Research Paper",
    description: "LaTeX paper with experiments",
    defaults: {
      version: "0.1.0",
      status: "active",
      skills: [
        { name: "session-management", source: "root" },
      ],
      context: {
        summary: "",
        open_prs: [],
        next_steps: [
          "Outline paper structure and contributions",
          "Set up experiment framework",
          "Run baseline experiments",
          "Analyze results and create figures",
          "Write and revise manuscript",
        ],
        blockers: [],
        notes: "",
      },
    },
  },
  {
    id: "multi-agent",
    label: "Multi-Agent Project",
    description: "A2A agent orchestration project",
    defaults: {
      version: "0.1.0",
      status: "active",
      skills: [
        { name: "multi-agent", source: "root" },
        { name: "code-review", source: "root" },
        { name: "ci-monitor", source: "root" },
      ],
      context: {
        summary: "",
        open_prs: [],
        next_steps: [
          "Define agent roles and responsibilities",
          "Set up inter-agent communication protocol",
          "Implement individual agent capabilities",
          "Build orchestration and coordination layer",
          "Write integration tests for agent workflows",
        ],
        blockers: [],
        notes: "",
      },
    },
  },
];

// ---------------------------------------------------------------------------
// YAML template loading
// ---------------------------------------------------------------------------

/**
 * Resolve the templates directory path.
 * Looks for a `templates/` folder relative to the project root.
 */
function templatesDir(): string {
  return join(process.cwd(), "templates");
}

/**
 * Load a single template from a YAML file and convert it to a ScenarioTemplate.
 */
function loadTemplateFromYaml(filePath: string): ScenarioTemplate {
  const content = readFileSync(filePath, "utf8");
  const parsed = yaml.load(content) as Scenario;
  const id = parsed.name;

  // Convert the full Scenario into a ScenarioTemplate
  const { name: _name, ...defaults } = parsed;
  return {
    id,
    label: id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
    description: parsed.description,
    defaults: defaults as Partial<Scenario>,
  };
}

/**
 * Load all YAML templates from the templates directory.
 * Returns empty array if directory doesn't exist.
 */
function loadYamlTemplates(): ScenarioTemplate[] {
  const dir = templatesDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith(".yaml"))
    .map(f => loadTemplateFromYaml(join(dir, f)));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all available scenario templates.
 */
export function getTemplates(): ScenarioTemplate[] {
  return [...builtinTemplates];
}

/**
 * List all available scenario templates (including YAML-based templates).
 * Prefers YAML templates when available; falls back to built-in definitions.
 */
export function listTemplates(): ScenarioTemplate[] {
  const yamlTemplates = loadYamlTemplates();
  if (yamlTemplates.length > 0) return yamlTemplates;
  return [...builtinTemplates];
}

/**
 * Get a specific template by ID.
 * Throws if the template does not exist.
 */
export function getTemplate(id: string): ScenarioTemplate {
  const template = builtinTemplates.find(t => t.id === id);
  if (!template) {
    throw new Error(`Template '${id}' not found. Available: ${builtinTemplates.map(t => t.id).join(", ")}`);
  }
  return template;
}

/**
 * Apply a template to create a full scenario object (without persisting).
 * The provided overrides take precedence over template defaults.
 */
export function applyTemplate(templateId: string, overrides: { name: string; description: string } & Partial<Scenario>): Scenario {
  const template = getTemplate(templateId);
  const scenario: Scenario = {
    ...template.defaults,
    ...overrides,
    name: overrides.name,
    version: overrides.version ?? template.defaults.version ?? "0.1.0",
    status: overrides.status ?? template.defaults.status ?? "active",
    description: overrides.description,
    context: {
      ...template.defaults.context,
      ...overrides.context,
    },
  };
  return scenario;
}

/**
 * Instantiate a new scenario from a template.
 *
 * Loads the template (from YAML or built-in), merges with overrides,
 * validates, and persists via createScenario().
 */
export function instantiateTemplate(
  templateId: string,
  overrides: { name: string; description: string } & Partial<Scenario>,
): Scenario {
  // Try YAML template first
  const yamlTemplates = loadYamlTemplates();
  const yamlTemplate = yamlTemplates.find(t => t.id === templateId);

  let scenario: Scenario;

  if (yamlTemplate) {
    scenario = {
      ...yamlTemplate.defaults,
      ...overrides,
      name: overrides.name,
      version: overrides.version ?? yamlTemplate.defaults.version ?? "0.1.0",
      status: overrides.status ?? yamlTemplate.defaults.status ?? "active",
      description: overrides.description,
      context: {
        ...yamlTemplate.defaults.context,
        ...overrides.context,
      },
    };
  } else {
    scenario = applyTemplate(templateId, overrides);
  }

  return createScenario(scenario);
}
