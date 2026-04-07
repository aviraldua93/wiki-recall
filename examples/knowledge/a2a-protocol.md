---
title: "Google Agent-to-Agent (A2A) Protocol"
type: concept
updated: "2025-06-15"
tags:
  - multi-agent
  - protocol
  - google
  - interoperability
  - ai-agents
related:
  - bun-runtime
  - karpathy-knowledge-base
---

## What It Is

The Agent-to-Agent (A2A) protocol is an open standard introduced by Google for enabling communication and task delegation between autonomous AI agents. It defines a common message format, capability discovery mechanism, and task lifecycle so that agents built by different teams (or different frameworks) can collaborate without bespoke integration code.

## Key Concepts

- **Agent Card**: A JSON document that describes an agent's capabilities, accepted input types, and endpoint URL. Other agents discover what a peer can do by reading its Agent Card — analogous to an OpenAPI spec for AI agents.
- **Task**: The fundamental unit of work in A2A. A task has a lifecycle: `submitted → working → completed | failed | canceled`. Tasks carry structured input and produce structured output (artifacts).
- **Artifact**: The output of a completed task — could be text, code, structured data, or a file reference. Artifacts are immutable once published and can be consumed by downstream agents.
- **Message**: A communication unit between agents within a task. Messages support text parts, data parts (structured JSON), and file parts (binary payloads). Agents exchange messages to negotiate, clarify, or stream intermediate results.
- **Capability Discovery**: Agents advertise their skills via Agent Cards hosted at a well-known URL (`/.well-known/agent.json`). Orchestrators query these cards to decide which agent to delegate a subtask to.
- **Push Notifications**: Optional webhook-based mechanism where an agent notifies a caller when a long-running task completes, avoiding polling.

## Architecture Patterns

### Hub-and-Spoke Orchestration

An orchestrator agent receives a complex task, decomposes it into subtasks, and delegates each to a specialist agent. The orchestrator reassembles artifacts from completed subtasks into a final result. This is the most common pattern for multi-agent systems.

### Peer-to-Peer Collaboration

Agents discover each other via Agent Cards and negotiate task handoffs directly. No central orchestrator — agents form ad-hoc chains based on capability matching. More resilient but harder to debug.

### Docs-as-Bus (File-Based A2A)

A lightweight variant where agents communicate by writing structured artifacts to a shared filesystem instead of HTTP. Each agent reads input from a directory, writes output to another. Enables full replay and debugging by inspecting the artifact trail. Used in CLI-based multi-agent systems where HTTP overhead is unnecessary.

## Protocol Flow

1. **Discovery** — Client reads the agent's Agent Card to understand capabilities
2. **Task Submission** — Client sends a task with input messages to the agent's endpoint
3. **Processing** — Agent works on the task, optionally sending streaming updates
4. **Completion** — Agent marks the task as completed and publishes artifacts
5. **Consumption** — Client retrieves artifacts and incorporates them into its workflow

## Best Practices

- **Design agents with single responsibilities** — one agent, one well-defined capability. Compose complex behavior through orchestration, not monolithic agents.
- **Make Agent Cards descriptive** — include clear capability descriptions, input/output schemas, and example payloads. Other agents (and humans) rely on these for integration.
- **Implement idempotent task handling** — tasks may be retried. Use task IDs to deduplicate and return cached results for repeated submissions.
- **Set timeouts on delegated tasks** — long-running agents can stall an entire pipeline. Implement timeout-based cancellation and fallback strategies.
- **Log the full message trail** — every message exchange within a task should be persisted for debugging and replay.

## Limitations

- The protocol is transport-agnostic in theory but most implementations assume HTTP/JSON — no official binary or gRPC binding yet.
- No built-in authentication or authorization standard — implementations must layer their own security.
- Capability discovery is static (Agent Cards) — no dynamic negotiation for partially matching capabilities.
- Error taxonomy is minimal — distinguishing between transient failures and permanent errors requires implementation-level conventions.

## Related Work

- Model Context Protocol (MCP) — Anthropic's protocol for connecting LLMs to tools and data sources. Complementary to A2A: MCP connects agents to tools, A2A connects agents to each other.
- OpenAI Assistants API — proprietary agent framework with built-in tool use. Not interoperable with A2A without an adapter layer.
- AutoGen / CrewAI — Python multi-agent frameworks that predate A2A. Many are adding A2A compatibility as an interop layer.
