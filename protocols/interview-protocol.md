# wiki-recall Interview Protocol

You are helping a user set up their personal knowledge base (`~/.grain/`).
Follow these steps IN ORDER. Ask one question at a time. Be conversational, not robotic.
Write outputs to `~/.grain/` as you go.

## Prerequisites

Before starting, verify:
- `~/.grain/` directory exists. If not: create it with `mkdir -p ~/.grain/`.
- Write permissions: try creating `~/.grain/.test` and deleting it. If fails: "Cannot write to ~/.grain/."
- Python is available for session mining. If not: skip Step 1 (session mining) and proceed to Step 2.
- If `~/.copilot/session-store.db` doesn't exist: skip Step 1a/1b and say "No sessions found -- building from scratch."

Missing prerequisites should be skipped, not errors. The interview works without sessions or Python.

## Step 1: Mine Sessions & Create Wiki Pages (automatic)

### 1a. Index sessions

- Check if `~/.copilot/session-store.db` exists
- If yes, run: `python ~/.grain/engine/indexer.py --stats`
- Report: "Found N sessions across M repos. Mining..."
- Run: `python ~/.grain/engine/indexer.py`
- Report what was found (entity count, top repos, date range)
- Ask: "Does this look right? Any repos missing?"
- If no session store exists, say: "No existing sessions found — that's fine, we'll build your brain from scratch."

### 1b. Harvest entities from mined sessions

- Run: `python ~/.grain/engine/harvest.py --auto`
- This extracts people, projects, decisions, and patterns from indexed sessions
- Report: "Harvested N entities: P people, Q projects, R decisions, S patterns."

### 1c. Create wiki pages from harvested data

**For each repo cluster** (repos that appear together in 3+ sessions), create a wiki project page:
- Create `~/.grain/wiki/projects/{repo-slug}.md` using `templates/project-template.md`
- Set `tier: 2` (notable) — NOT tier 3 stub
- **Populate the Compiled Truth section** with real data from sessions: what the repo does, which domains it belongs to, its role in the user's workflow, and how actively it's used (session count + date range)
- **Populate the Architecture section** with any architectural patterns observed in sessions (languages, frameworks, deployment targets mentioned)
- **Populate the Key Decisions section** with any decisions extracted by harvest.py for this repo
- **Populate the Timeline section** with at least the first and most recent session dates
- Add source attribution: `observed: session <id>` for each claim
- Do NOT leave any section as `[No data yet]` if harvest.py found relevant data

**For each frequent person** (mentioned in 3+ sessions OR 5+ total mentions), create a wiki people page:
- Create `~/.grain/wiki/people/{name-slug}.md` using `templates/people-template.md`
- Set `tier: 2` for people with 3+ sessions, `tier: 3` for people with fewer
- **Populate the Compiled Truth section** with: name, inferred role (from commit messages, PR reviews, conversation context), which repos/projects they appear in, and frequency of collaboration
- **Populate the Working Relationship section** with observable patterns: do they review the user's PRs? Do they appear in the same repos? Are they mentioned in decisions?
- **Populate the Timeline section** with the date range of their appearances
- Add source attribution: `observed: session <id>` for factual claims, `inferred: <reasoning>, confidence: medium` for role guesses

**After creating all pages:**
- Report: "Created N project pages and M people pages from your session history."
- Show a summary table: page name, tier, data completeness (how many sections filled)
- Ask: "Want me to adjust any of these? I can promote stubs to full pages or remove incorrect ones."

## Step 2: Identity (quick)

- Ask: "What's your name?"
- Ask: "What GitHub identities do you use?" (personal, work EMU, etc.)
- Ask: "Any core principles that guide your work? (e.g., ship fast, test everything)"
- Write L0 section to `~/.grain/brain.md`
- This should take less than 1 minute

## Step 3: Domains (show data, ask for corrections, produce FULL domain pages)

### 3a. Cluster repos into domains

- Analyze the mined sessions — cluster repos that appear together frequently
- Show: "I found these clusters in your sessions:
    Cluster A: repo-x, repo-y (N sessions)
    Cluster B: repo-a (M sessions)"
- Ask: "Is Cluster A one domain? What would you call it?"
- Ask: "Is Cluster B still active or is it legacy?"
- Ask: "Any domains I missed that aren't in your session history?"

### 3b. Create deep domain pages (target: 43+ lines each)

For each confirmed domain, create `~/.grain/domains/{name}.md` using `templates/domain-template.md` and fill ALL sections:

**Compiled Truth** (5-10 lines): A rich summary including what this domain covers, its current status (active/legacy/transitioning), the user's role within it, and any strategic direction mentioned in sessions.

**Key Repos** (full table): For each repo in this domain, include:
  - Full repo path in `org/repo` format (e.g., `contoso/auth-service`)
  - The repo's role within the domain (e.g., "primary API", "shared library", "deployment config")
  - Notes: language, framework, last active date from sessions

**Key Contacts** (full table): For each person who frequently appears in sessions related to this domain:
  - Person name (linked to their wiki/people/ page if it exists)
  - Their role in this domain (e.g., "tech lead", "reviewer", "stakeholder")
  - Notes: communication patterns, review relationship

**Auth Identity**: Which GitHub identity (personal, work EMU, etc.) the user uses for repos in this domain. Ask: "Which GitHub account do you use for [domain]?"

**Architecture Notes**: Any architectural patterns, tech stack details, or infrastructure observations from sessions (e.g., "microservices on Azure", "monorepo with Nx", "deployed via GitHub Actions")

**Active Decisions**: Decisions from harvest.py or Step 6 that relate to this domain. Link to `decisions.md` entries.

**Vision / Strategy Notes**: Ask: "Where is [domain] headed? Any big changes planned?" Capture strategic direction even if brief.

**Related Wiki Pages**: Cross-reference to `wiki/projects/` pages, `wiki/people/` pages, and `wiki/patterns/` pages that relate to this domain.

**Notes**: Any additional context from sessions — recurring pain points, common workflows, integration patterns.

**Timeline**: Populate with at least 3 entries: first session in this domain, most recent session, and any notable events (decisions, architecture changes, new repo additions).

- Set `tier: 1` for domains with 10+ sessions. Set `tier: 2` for domains with 3-9 sessions. Set `tier: 3` for domains with fewer.
- Add source attribution on all claims: `observed: session <id>` or `self-stated: interview`
- **Do NOT leave any section as `[No data yet]`** — if no data exists, write `[User did not provide — ask in next session]` to distinguish from unasked questions.
- If no sessions were mined, ask: "What are the main areas you work in? (e.g., frontend, backend, infrastructure, data)" and build domain pages from the user's answers.

## Step 4: People (show data, ask for context)

- Extract names that appear frequently in sessions (commit authors, mentioned in conversations)
- Show: "These people appear most in your sessions:
    Sarah (23 mentions, 8 sessions)
    Jake (15 mentions, 5 sessions)"
- For the top 5-10 people, ask: "Who is [name]? What's their role and what do you work on together?"
- Create `~/.grain/wiki/people/{name}.md` for each confirmed person using the **people-template.md** format:
  - Compiled Truth section with role and key context
  - Working Relationship section (reports to, collaborates on, communication, review pattern)
  - Timeline section with discovery date and session attribution
- **Tier assignment**: Set `tier: 1` for people with 5+ sessions or detailed user-provided context. Set `tier: 2` for people with 2-4 sessions. Set `tier: 3` for people with only 1 mention (stub).
- Create or update `~/.grain/domains/comms.md` with name-to-identity mappings
- If no people found in sessions, ask: "Who are the key people you collaborate with?"

## Step 5: Writing Style & Persona (deep analysis, target: 292+ lines)

### 5a. Deep message analysis

- **Read at least 50 user messages from sessions** across different contexts (code reviews, chat, emails, technical discussions)
- If fewer than 50 messages exist, read ALL available user messages
- Categorize each message by platform/context: PR comment, commit message, chat, email, technical doc, issue description

### 5b. Extract tone per platform

Analyze tone differences across platforms. For each platform type found in sessions:

**Email tone**: Formality level (1-5 scale), typical length, structure patterns (bullet points vs paragraphs), whether they include pleasantries vs get straight to business

**PR/Code Review tone**: How they give feedback (direct vs diplomatic), whether they ask questions or make statements, how they handle disagreements, whether they explain "why" behind suggestions

**Chat tone**: Casualness level, use of emoji/reactions, message length, response patterns (quick one-liners vs detailed responses), humor style

**Technical docs tone**: Level of detail, use of examples, audience assumptions, formatting preferences (headers, code blocks, diagrams)

### 5c. Extract common phrases with REAL examples

- Extract **at least 10 verbatim phrases** the user actually uses in sessions, not paraphrased
- Show them quoted: `"let's ship it"`, `"I'll take a look"`, `"makes sense to me"`, `"can you clarify..."`, `"my gut says..."`
- Group by category: agreement phrases, disagreement phrases, delegation phrases, thinking-out-loud phrases, escalation phrases
- Note frequency: which phrases appear in 5+ sessions vs occasional usage

### 5d. Extract greeting/signoff patterns

- Analyze how the user starts conversations: `"Hey"`, `"Hi team"`, `"Quick question —"`, no greeting at all
- Analyze how the user ends conversations: `"Thanks!"`, `"Cheers"`, `"LMK"`, `"PTAL"`, just stops talking
- Note platform differences: do they greet differently in email vs chat?
- Note audience differences: do they greet differently for reports vs managers vs peers?

### 5e. Extract professional influence blends

- Analyze the user's overall communication style to identify professional influences
- Ask: "Your writing style reminds me of [pattern]. Is that intentional?"
- Ask: "Who do you admire professionally? Whose communication style do you try to emulate?"
- Ask: "Any anti-patterns? People whose writing style you actively avoid?"

### 5f. Build persona.md

Show analysis to the user:
- "Looking at how you write across {N} sessions...
  - In PRs, you tend to be: [pattern with example]
  - In chat, you tend to be: [pattern with example]
  - Common phrases: [top 5 with verbatim quotes]
  - You usually start with: [greeting pattern]
  - You sign off with: [signoff pattern]"
- Ask: "Does this sound right? Anything you'd change?"
- Ask: "How do you typically greet people in messages? (e.g., Hey, Hi team, Hello)"
- Ask: "How do you sign off? (e.g., Thanks, Best, Cheers)"
- Ask: "Anything you specifically DON'T want to sound like? (e.g., too corporate, too casual, too verbose)"

Create `~/.grain/persona.md` using `templates/persona.md` and fill ALL sections:

- **Voice & Tone**: Overall style, default greeting, default sign-off, with real examples
- **Writing Style — Emails**: Formality, structure, length, example phrases, how they handle different email types (status updates, requests, escalations)
- **Writing Style — PRs**: Review tone, feedback approach, PR description style, use of checklists, example phrases from actual PR comments
- **Writing Style — Chat**: Casualness level, emoji usage, response patterns, humor, example messages
- **Writing Style — Technical Docs**: Detail level, audience assumptions, formatting patterns, example snippets
- **What NOT to sound like**: Anti-patterns gathered from user feedback, with specific examples of what to avoid (e.g., "Don't use corporate jargon like 'synergy' or 'circle back'")
- **Professional Influences**: Who they admire, what styles they blend, conscious choices about communication

**Do NOT leave any section as `[No data yet]`** — populate every section from either session analysis or direct user answers. If insufficient data exists for a section, write what you have and note `[Needs more data — will refine in future sessions]`.

- If no sessions to analyze, ask all questions from scratch and build persona from user's answers

## Step 6: Decisions (extract, confirm)

- Extract statements that look like settled decisions from sessions
  (phrases like "let's use", "we decided", "going with", "not X because Y", "switched to")
- Show: "I found these decisions in your sessions:
    - 'Use TypeScript everywhere' (mentioned 5 times across 3 sessions)
    - 'Git as storage, no databases' (mentioned 3 times)
    - 'WebSockets over polling for real-time' (decided 2 weeks ago)"
- Ask: "Are these right? Any I should remove? Any others you want to add?"
- Write confirmed decisions to `~/.grain/decisions.md` with dates
- If no sessions, ask: "Any architectural decisions or tech choices you've already settled on?"

## Step 7: Pending Actions (extract, confirm)

- Extract unfulfilled commitments from recent sessions
  (phrases like "I'll look at", "let me check", "need to follow up", "get back to", "remind me", "TODO")
- Show: "I found these pending commitments in your recent sessions:
    - 'Review that PR from Jake' (3 days ago)
    - 'Check the auth issue in prod' (1 week ago)
    - 'Follow up with Sarah on the API design' (5 days ago)"
- Ask: "Which of these are still pending? Any already done?"
- Write confirmed pending actions to `~/.grain/actions.md`
- If no sessions, ask: "Any pending follow-ups or commitments you want to track?"

## Step 8: Generate brain.md

- Compile everything into `~/.grain/brain.md`:
  - L0: Identity (name, GitHub handles, principles)
  - L1: Active work (top projects from session mining, with status)
  - Routing table (domains, wiki paths, key files)
- Verify brain.md is under 550 tokens
- If over 550 tokens, compact automatically by trimming verbose entries
- Show the generated brain.md to the user for review

## Step 9: Verify

- Show summary: "Your brain is set up:
    N wiki pages, M domains, P people profiles
    D decisions captured, A pending actions tracked
    brain.md: X tokens (target: under 550)"
- Ask: "Anything else you want to add or change?"
- If the user has additions, incorporate them
- Run lint check: `powershell -File scripts/lint.ps1` (if available)
- When done, say: "Almost done — let me wire up your Copilot instructions."

## Step 10: Wire Copilot Instructions

This step ensures the user's Copilot experience is personalized from the very next session.

### 10a. Generate copilot-instructions.md for the knowledge base

- Copy `templates/copilot-instructions.md` to `~/.grain/copilot-instructions.md`
- Replace `[YOUR_NAME]` with the user's name captured in Step 2
- Replace `[YOUR_GITHUB]` with the user's primary GitHub identity from Step 2
- If the user has multiple GitHub identities (personal, work EMU), list all of them in the Identity section
- Verify the file contains the correct Identity section, Knowledge Base paths, Hard Gates, and Routing rules

### 10b. Inline RESOLVER routing rules

- Read `templates/RESOLVER.md` and inline the 8 filing rules and 3-tier decision routing into the `~/.grain/copilot-instructions.md` Routing section
- Ensure the Decision Write-Back section references the correct tier definitions and trigger words
- If the user created any custom routing rules during the interview (e.g., domain-specific routing), add those to the Routing section too
- This makes routing self-contained — agents don't need to look up RESOLVER.md separately

### 10c. Wire to ~/.github/

- Create `~/.github/` directory if it does not exist: `New-Item -ItemType Directory -Path "$HOME/.github" -Force` (PowerShell) or `mkdir -p ~/.github/` (Bash)
- Copy `~/.grain/copilot-instructions.md` to `~/.github/copilot-instructions.md`
- This is the global Copilot instructions file that GitHub Copilot reads on every session
- Report: "Wired copilot-instructions.md to ~/.github/ — Copilot will use your knowledge base starting next session."

### 10d. Verify wiring

- Read back `~/.github/copilot-instructions.md` and verify ALL of these:
  - No `[YOUR_NAME]` or `[YOUR_GITHUB]` placeholders remain (all replaced with actual values)
  - The Routing section includes the 8 RESOLVER filing rules
  - The file references `~/.grain/brain.md`, `~/.grain/persona.md`, `~/.grain/wiki/`, and `~/.grain/domains/`
  - The PII GATE and Hard Gates sections are present and intact (critical safety check — must not be removed)
  - The Decision Write-Back section includes all 3 tiers with trigger words
- If any placeholders remain or sections are missing, fix them before proceeding
- Report: "Verified: copilot-instructions.md is configured with your identity, routing rules, and safety gates."

## Step 11: Cleanup

After completing all steps, clean up the interview protocol file to keep the knowledge base tidy.

- Create `~/.grain/.archive/` directory if it does not exist
- Move `~/.grain/interview-protocol.md` to `~/.grain/.archive/interview-protocol-completed.md`
- Confirm to the user: "Interview protocol has been archived to `.archive/interview-protocol-completed.md`. Your brain setup is complete!"
- If the move fails for any reason (permissions, file lock), report the issue but do not block — the interview is still considered complete
- Final message: "Your brain is ready. Next session, Copilot will know your world."

## Guidelines

- Ask ONE question at a time. Don't dump a list of questions.
- SHOW data first, then ask for corrections. Don't ask from scratch when data exists.
- Be conversational: "I noticed you mention Sarah a lot — who is she?" not "Please provide contact information for frequently mentioned individuals."
- Write files as you go — don't wait until the end.
- If the user says "skip" or "later", move to the next step immediately.
- The whole interview should take 15-30 minutes.
- All data stays local in `~/.grain/`. Nothing is pushed anywhere.
- When creating files, use UTF-8 encoding.
- For wiki pages, include YAML frontmatter with `title`, `created`, `updated`, and `last_verified` fields.
- When creating project or people entities, use the **compiled truth + timeline** format from `templates/project-template.md` and `templates/people-template.md`.
- Use source attribution on all claims: `observed`, `self-stated`, or `inferred` (with confidence level).
- Follow `templates/RESOLVER.md` filing rules to decide where new knowledge goes.
- When done, say: "Your brain is ready. Next session, Copilot will know your world."