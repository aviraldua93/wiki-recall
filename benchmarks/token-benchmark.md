# Token Benchmark Methodology

Measures the real-world token cost of wiki-recall's layered memory system.

## Setup

1. Fresh `~/.grain/` from setup wizard (no prior sessions)
2. Populate with 10+ projects, 20+ wiki pages, 50+ decisions
3. Use a model with visible token counts (e.g., Claude via API)

## Test Sessions

Run 5 real sessions, each measuring:
- **Input tokens**: How many tokens Copilot sends (includes instructions + brain.md)
- **Output tokens**: First response token count
- **Cached tokens**: Tokens served from context cache

### Session Types

| # | Scenario | Expected L-layers |
|---|----------|-------------------|
| 1 | Cold start: "What am I working on?" | L0 + L1 only |
| 2 | Project recall: "What do I know about X?" | L0 + L1 + L2 |
| 3 | Semantic search: "Have I dealt with rate limiting?" | L0 + L1 + L3 |
| 4 | Cross-project: debug → pattern match → decision | L0 + L1 + L2 + L3 |
| 5 | Full stack: all layers exercised | L0 + L1 + L2 + L3 + L4 |

## Metrics

| Metric | How to Measure |
|--------|---------------|
| Wake-up cost | Input tokens for session 1 (brain.md only) |
| L2 cost | Delta between session 2 and session 1 |
| L3 cost | Delta between session 3 and session 1 |
| Full stack cost | Total input tokens for session 5 |
| Naive baseline | Concatenate ALL wiki + decisions + domains → count tokens |
| Savings % | `1 - (wake_up_cost / naive_baseline) * 100` |

## Target Numbers

| Metric | Target | Rationale |
|--------|--------|-----------|
| Wake-up (L0+L1) | < 600 tokens | brain.md template is ~550 tokens |
| Full stack | < 3,000 tokens | Even worst-case should be manageable |
| Naive baseline | > 10,000 tokens | Typical after 1 month of use |
| Savings | > 95% | The whole point of layered recall |

## Running the Benchmark

```bash
# 1. Count brain.md tokens (approximate: chars / 4)
python -c "print(len(open('~/.grain/brain.md').read()) // 4)"

# 2. Count naive baseline (all .md files concatenated)
python -c "
from pathlib import Path
total = sum(len(f.read_text()) for f in Path.home().joinpath('.grain').rglob('*.md'))
print(f'Naive baseline: ~{total // 4} tokens')
"

# 3. Run TypeScript benchmark suite for automated measurement
bun run benchmark --suite token-efficiency
```

## Results Template

| Metric | Value | Date |
|--------|-------|------|
| Wake-up (L0+L1) | ___ tokens | YYYY-MM-DD |
| L2 recall | ___ tokens | YYYY-MM-DD |
| L3 search | ___ tokens | YYYY-MM-DD |
| Full stack | ___ tokens | YYYY-MM-DD |
| Naive baseline | ___ tokens | YYYY-MM-DD |
| **Savings** | **____%** | YYYY-MM-DD |

## Notes

- Token counts are approximate (chars / 4 for English text)
- Real token counts vary by model tokenizer
- The TypeScript benchmark suite in `benchmarks/` uses seeded mock data for reproducible results
- For real-world measurement, use the API's `usage` response field
