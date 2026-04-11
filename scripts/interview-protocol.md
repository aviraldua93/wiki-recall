# wiki-recall Interview Protocol

You are helping a user set up their personal knowledge base (`~/.grain/`).
Follow these steps IN ORDER. Ask one question at a time. Be conversational, not robotic.
Write outputs to `~/.grain/` as you go.

## Step 1: Mine Sessions (automatic)

- Check if `~/.copilot/session-store.db` exists
- If yes, run: `python ~/.grain/engine/indexer.py --stats`
- Report: "Found N sessions across M repos. Mining..."
- Run: `python ~/.grain/engine/indexer.py`
- Report what was found (entity count, top repos, date range)
- Ask: "Does this look right? Any repos missing?"
- If no session store exists, say: "No existing sessions found — that's fine, we'll build your brain from scratch."

## Step 2: Identity (quick)

- Ask: "What's your name?"
- Ask: "What GitHub identities do you use?" (personal, work EMU, etc.)
- Ask: "Any core principles that guide your work? (e.g., ship fast, test everything)"
- Write L0 section to `~/.grain/brain.md`
- This should take less than 1 minute

## Step 3: Domains (show data, ask for corrections)

- Analyze the mined sessions — cluster repos that appear together frequently
- Show: "I found these clusters in your sessions:
    Cluster A: repo-x, repo-y (N sessions)
    Cluster B: repo-a (M sessions)"
- Ask: "Is Cluster A one domain? What would you call it?"
- Ask: "Is Cluster B still active or is it legacy?"
- Ask: "Any domains I missed that aren't in your session history?"
- For each confirmed domain, create `~/.grain/domains/{name}.md` with:
  - Repos listed
  - Session count
  - Key topics extracted from sessions
  - Last active date
- If no sessions were mined, ask: "What are the main areas you work in? (e.g., frontend, backend, infrastructure, data)"

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

## Step 5: Writing Style (analyze, confirm)

- Analyze user's actual messages from sessions (how they phrase requests, greetings, tone)
- Show: "Looking at how you write in sessions... You tend to be: [direct/formal/casual/terse].
    Common phrases: [examples from their sessions]
    You usually start with: [greeting pattern]"
- Ask: "Does this sound right? Anything you'd change?"
- Ask: "How do you typically greet people in messages? (e.g., Hey, Hi team, Hello)"
- Ask: "How do you sign off? (e.g., Thanks, Best, Cheers)"
- Create `~/.grain/persona.md` with the captured voice profile
- If no sessions to analyze, ask these questions from scratch

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
- When done, say: "Your brain is ready. Next session, Copilot will know your world."

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
