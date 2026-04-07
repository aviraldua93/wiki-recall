/**
 * Core TypeScript types for DevContext.
 *
 * These interfaces mirror the JSON Schema definitions in schemas/ and serve as
 * the single source of truth for TypeScript consumers.
 */

// ---------------------------------------------------------------------------
// Skill source layers — root > team > personal promotion pipeline
// ---------------------------------------------------------------------------

export type SkillSource = "root" | "team" | "personal";

// ---------------------------------------------------------------------------
// Scenario lifecycle states
// ---------------------------------------------------------------------------

export type ScenarioStatus = "active" | "paused" | "handed-off" | "archived";

// ---------------------------------------------------------------------------
// Knowledge entity type classification
// ---------------------------------------------------------------------------

export type KnowledgeEntityType =
  | "platform"
  | "system"
  | "repo"
  | "tool"
  | "concept"
  | "person"
  | "team";

// ---------------------------------------------------------------------------
// Knowledge entity scope
// ---------------------------------------------------------------------------

export type KnowledgeScope = "scenario" | "global";

// ---------------------------------------------------------------------------
// Repo reference — a git repository associated with a scenario
// ---------------------------------------------------------------------------

export interface RepoRef {
  /** Git repository URL (e.g. https://github.com/org/repo). */
  url: string;
  /** Git branch to check out. */
  branch: string;
  /** Why this repo is included in the scenario. */
  purpose?: string;
}

// ---------------------------------------------------------------------------
// Skill reference — a skill loaded into a scenario
// ---------------------------------------------------------------------------

export interface Skill {
  /** Skill identifier (e.g. "code-review"). */
  name: string;
  /** Origin layer of the skill. */
  source: SkillSource;
}

// ---------------------------------------------------------------------------
// Knowledge reference — a knowledge entity attached to a scenario
// ---------------------------------------------------------------------------

export interface KnowledgeRef {
  /** Knowledge entity identifier. */
  name: string;
  /** Visibility scope of the knowledge entity. */
  scope?: KnowledgeScope;
}

// ---------------------------------------------------------------------------
// Scenario context — current working state and session information
// ---------------------------------------------------------------------------

export interface ScenarioContext {
  /** Free-text summary of current work. */
  summary?: string;
  /** Open pull request references (e.g. "repo#42"). */
  open_prs?: string[];
  /** Ordered list of next actions. */
  next_steps?: string[];
  /** Current blockers preventing progress. */
  blockers?: string[];
  /** Free-form notes and observations. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Scenario — the top-level working scenario manifest
// ---------------------------------------------------------------------------

export interface Scenario {
  /** Unique UUID identifier for the scenario (auto-generated). */
  id?: string;
  /** Unique kebab-case identifier for the scenario. */
  name: string;
  /** Semantic version string (e.g. "0.1.0"). */
  version: string;
  /** Current lifecycle state of the scenario. */
  status: ScenarioStatus;
  /** One-line human-readable description. */
  description: string;
  /** Git repositories associated with this scenario. */
  repos?: RepoRef[];
  /** Skills loaded into this scenario. */
  skills?: Skill[];
  /** Knowledge entities attached to this scenario. */
  knowledge?: KnowledgeRef[];
  /** Current working context and session state. */
  context?: ScenarioContext;
  /** ISO 8601 timestamp when the scenario was created (auto-generated). */
  created_at?: string;
  /** ISO 8601 timestamp when the scenario was last updated (auto-managed). */
  updated_at?: string;
}

// ---------------------------------------------------------------------------
// Knowledge entity — Karpathy-style mental model stored as Markdown + YAML
// ---------------------------------------------------------------------------

export interface KnowledgeEntity {
  /** Human-readable name of the entity. */
  title: string;
  /** Classification of what this entity represents. */
  type: KnowledgeEntityType;
  /** ISO 8601 date when the entity was last updated (YYYY-MM-DD). */
  updated: string;
  /** Searchable tags for categorization. */
  tags?: string[];
  /** IDs of related knowledge entities. */
  related?: string[];
  /** Markdown body content (not in frontmatter — populated after parsing). */
  content?: string;
  /** ISO 8601 date when the entity was created (YYYY-MM-DD). */
  created?: string;
  /** Source document paths or identifiers this entity was derived from. */
  sources?: string[];
  /** Number of distinct source documents backing this entity. */
  source_count?: number;
  /** Entity lifecycle status (Karpathy methodology). */
  status?: 'draft' | 'reviewed' | 'needs_update';
}
