---
name: multi-agent
description: Multi-agent workflow orchestration using docs-as-bus pattern for parallel task execution
version: "1.0.0"
source: root
---

# Multi-Agent Skill

A framework for orchestrating multiple AI agents working in parallel on a shared codebase, using a docs-as-bus communication pattern where agents coordinate through structured files rather than direct messaging.

## When to Use

Use this skill whenever you need to:

- **Parallelize a large task** across multiple agents, each handling an independent work stream
- **Coordinate multi-file changes** where different agents are responsible for different modules or layers
- **Implement a feature end-to-end** with agents working simultaneously on backend, frontend, tests, and documentation
- **Manage agent dependencies** where one agent's output is another agent's input
- **Review and integrate work** from multiple agents into a coherent whole
- **Scale engineering throughput** on time-sensitive deliverables by running agents concurrently
- **Debug integration issues** when independently developed components do not work together

Activate this skill when a task is too large or complex for a single agent to complete efficiently, and the work can be decomposed into parallel streams with well-defined interfaces.

## How to Execute

### Phase 1 — Task Decomposition

Break the work into parallelizable units:

1. **Identify independent work streams**: Analyze the task and separate it into components that can be developed concurrently. Good decomposition boundaries include:
   - Module boundaries (each agent owns a distinct module)
   - Layer boundaries (backend agent, frontend agent, test agent)
   - Feature boundaries (each agent implements one feature end-to-end)

2. **Define interfaces between streams**: For each pair of agents that will need to integrate, specify:
   - Shared type definitions or API contracts
   - File naming conventions and directory ownership
   - Data formats for inter-agent communication

3. **Map dependencies**: Create a dependency graph showing which tasks must complete before others can start. Use this to determine:
   - Which agents can launch immediately (no dependencies)
   - Which agents must wait (have upstream dependencies)
   - Critical path through the dependency graph

4. **Assign roles**: Give each agent a clear role with:
   - A descriptive name (e.g., "backend-api-dev", "test-writer", "docs-author")
   - A specific scope of files and directories they own
   - Explicit list of tools they are allowed to use
   - Clear acceptance criteria for their deliverables

### Phase 2 — Communication Setup (Docs-as-Bus)

Establish the docs-as-bus communication channel:

1. **Create an artifacts directory**: Use a shared `artifacts/` directory as the communication bus. Each agent writes their deliverables and status updates here.

2. **Define artifact format**: Each completed task produces an artifact file:
   ```
   artifacts/<task-id>.md
   ```
   The artifact contains:
   - Summary of completed work
   - List of files created or modified
   - Acceptance criteria checklist
   - Any information downstream agents need

3. **Dependency polling**: Agents check for upstream artifacts before starting dependent tasks:
   - Look for `artifacts/<dependency-task-id>.md`
   - If not found, wait and retry (with backoff)
   - If found, read the artifact to get context needed for the current task

4. **Status signaling**: Agents communicate progress through:
   - File existence (artifact file = task complete)
   - Bridge API calls for real-time status updates
   - Checkpoint files for long-running tasks

### Phase 3 — Parallel Execution

Launch and manage the agent fleet:

1. **Start independent agents first**: Launch all agents whose tasks have no unmet dependencies. They can begin working immediately.

2. **Monitor progress**: Track which agents have completed their tasks by watching the artifacts directory:
   - Each completed task produces an artifact file
   - Failed tasks should write error artifacts with diagnostic information
   - Stalled agents (no progress for extended time) may need intervention

3. **Handle failures**: When an agent fails:
   - Read the error artifact to understand the failure
   - Determine if the failure blocks downstream agents
   - Either retry the failed task or reassign it
   - Update the dependency graph to reflect the new state

4. **Manage resource contention**: Prevent agents from conflicting:
   - Assign clear file ownership — no two agents should edit the same file
   - Use separate branches if agents need to modify overlapping files
   - Serialize agents that must modify shared state (e.g., package.json)

### Phase 4 — Integration and Verification

Bring the parallel work streams together:

1. **Collect all artifacts**: Verify that every task in the dependency graph has a completed artifact.

2. **Run integration checks**:
   - Build the combined codebase (`bun run build` or equivalent)
   - Run the full test suite (`bun test`)
   - Run the linter (`bun run lint`)
   - Verify no conflicting changes (duplicate definitions, incompatible interfaces)

3. **Resolve integration issues**: Common problems when integrating multi-agent work:
   - **Type mismatches**: Agents used different types for the same concept. Fix by aligning with the shared type definitions.
   - **Naming conflicts**: Two agents chose the same name for different things. Rename one to be more specific.
   - **Missing glue code**: Agents built components that do not connect. Write adapter code to bridge the gap.
   - **Inconsistent conventions**: Agents used different coding styles. Normalize to the project's established conventions.

4. **Final validation**: Run the complete acceptance criteria for the overall task, not just individual agent deliverables.

## Expected Outputs

### Orchestration Plan

```
## Multi-Agent Orchestration Plan
- **Task**: [Overall task description]
- **Agents**: [Count]
- **Estimated Duration**: [Time]
- **Critical Path**: [task-a] → [task-c] → [task-e]

### Agent Assignments
| Agent | Role | Owns | Depends On | Deliverable |
|-------|------|------|------------|-------------|
| agent-1 | Backend Dev | src/api/ | foundation | API routes + tests |
| agent-2 | Frontend Dev | src/ui/ | foundation | UI components |
| agent-3 | Test Writer | tests/ | agent-1, agent-2 | Integration tests |
```

### Progress Dashboard

```
## Orchestration Progress — [Timestamp]
| Task | Agent | Status | Artifact | Blockers |
|------|-------|--------|----------|----------|
| foundation | agent-0 | ✅ Done | artifacts/foundation.md | None |
| api-routes | agent-1 | 🔄 Running | — | None |
| ui-components | agent-2 | 🔄 Running | — | None |
| integration-tests | agent-3 | ⏳ Waiting | — | api-routes, ui-components |
```

### Integration Report

```
## Integration Report
- **All Artifacts Collected**: Yes/No
- **Build Status**: ✅ Pass / ❌ Fail
- **Test Status**: ✅ Pass / ❌ Fail ([X] passed, [Y] failed)
- **Lint Status**: ✅ Pass / ❌ Fail
- **Integration Issues Found**: [Count]
- **Resolution Summary**: [Brief description of fixes applied]
```

## Multi-Agent Best Practices

- **Keep agents focused**: Each agent should have a single, well-defined responsibility
- **Over-specify interfaces**: Ambiguous contracts between agents cause integration failures. Define types, formats, and naming conventions explicitly
- **Fail fast**: Agents should report errors immediately rather than trying to work around missing dependencies
- **Minimize shared state**: The fewer files and resources that agents share, the fewer conflicts arise
- **Plan for re-runs**: Design tasks to be idempotent so failed agents can be retried safely
- **Document decisions**: Each agent should record non-obvious decisions in their artifact so other agents (and humans) understand the rationale
