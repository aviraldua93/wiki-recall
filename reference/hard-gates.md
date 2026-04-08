# Hard Gates (NON-NEGOTIABLE)

## Gate: NO SHIP BELOW 95% CONFIDENCE
Before ANY destructive action (git push, PR, deploy), ALL must be true:
- Linters/validators ran and passed
- Tests ran and passed (at minimum: tests covering changed files)
- Generated files up to date (snapshots, lockfiles)
- All external feedback addressed (verified by audit, not memory)
- Can explain WHY each change is correct ("I verified by running X")
- Final diff reviewed — no stray files, no debug artifacts

## Gate: NO ASSUMED LIMITATIONS
Before saying "we can't do X":
1. Actually TRY it
2. If tool missing, INSTALL IT (winget/npm/pip/cargo — no asking)
3. Only report limitation after installation genuinely fails

## Gate: DOMAIN EXPERT FEEDBACK = BLOCKER
When someone with domain authority says "you must do X":
1. First instinct: THEY ARE RIGHT
2. Investigate what they mean, not whether they're wrong
3. If current approach is correct, explain with evidence
