# DevContext Memory Architecture — Benchmark Results

> Generated: 2026-04-08T16:57:07.335Z

## Executive Summary

- **token-efficiency**: Full stack uses ~203 tokens vs 13022 baseline (98.44% savings). 50 entities, 100 sessions.
- **recall-precision**: Overall: 50% recall, 100% precision across 200 queries. 50 entities, 100 sessions.
- **routing-accuracy**: Overall routing accuracy: 43% across 21 fixed test cases. Generated query accuracy: 64% across 50 queries.
- **scale-stress**: Tested 10, 50, 100, 500, 1000 entities. Degradation: none detected. Max latency: 960.0ms at 1000 entities.
- **layer-comparison**: Hybrid: 50% recall, 100% precision, 216 avg tokens. Wiki Only: 17% recall, 199 tokens. Search Only: 0% recall, 21 tokens. Hybrid recall advantage: +33pp vs wiki, +49.5pp vs search.

## Token Efficiency

*Token usage across layer combinations vs dump-everything baseline*

Started: 2026-04-08T16:56:01.930Z | Completed: 2026-04-08T16:56:05.055Z

| Name | Metric | Value | Unit |
|------|--------|------:|------|
| L0 only | avg_tokens | 36 | tokens |
| L0 only | token_savings_vs_baseline | 99.72 | % |
| L0 + L1 | avg_tokens | 203 | tokens |
| L0 + L1 | token_savings_vs_baseline | 98.44 | % |
| L0 + L1 + L2 | avg_tokens | 203 | tokens |
| L0 + L1 + L2 | token_savings_vs_baseline | 98.44 | % |
| L0 + L1 + L2 + L3 | avg_tokens | 203 | tokens |
| L0 + L1 + L2 + L3 | token_savings_vs_baseline | 98.44 | % |
| Full stack (L0–L4) | avg_tokens | 203 | tokens |
| Full stack (L0–L4) | token_savings_vs_baseline | 98.44 | % |
| Baseline (dump everything) | total_tokens | 13022 | tokens |

**Summary**: Full stack uses ~203 tokens vs 13022 baseline (98.44% savings). 50 entities, 100 sessions.

---

## Recall Precision

*Recall and precision across query types and memory layers*

Started: 2026-04-08T16:56:05.067Z | Completed: 2026-04-08T16:56:24.898Z

| Name | Metric | Value | Unit |
|------|--------|------:|------|
| Overall | recall | 49.50 | % |
| Overall | precision | 100 | % |
| Layer L0 | recall | 0 | % |
| Layer L0 | precision | 0 | % |
| Layer L1 | recall | 0 | % |
| Layer L1 | precision | 0 | % |
| Layer L2 | recall | 48.53 | % |
| Layer L2 | precision | 59.76 | % |
| Layer L3 | recall | 0 | % |
| Layer L3 | precision | 0 | % |
| Layer L4 | recall | 100 | % |
| Layer L4 | precision | 100 | % |

**Summary**: Overall: 50% recall, 100% precision across 200 queries. 50 entities, 100 sessions.

---

## Routing Accuracy

*Query routing accuracy to correct memory layer(s)*

Started: 2026-04-08T16:56:24.910Z | Completed: 2026-04-08T16:56:30.267Z

| Name | Metric | Value | Unit |
|------|--------|------:|------|
| Overall Routing | accuracy | 42.86 | % |
| Layer L0 | routing_accuracy | 100 | % |
| Layer L1 | routing_accuracy | 100 | % |
| Layer L2 | routing_accuracy | 0 | % |
| Layer L3 | routing_accuracy | 0 | % |
| Layer L4 | routing_accuracy | 0 | % |
| Generated Queries | routing_accuracy | 64 | % |

**Summary**: Overall routing accuracy: 43% across 21 fixed test cases. Generated query accuracy: 64% across 50 queries.

---

## Scale Stress

*Performance under increasing entity counts (10 to 1000)*

Started: 2026-04-08T16:56:30.279Z | Completed: 2026-04-08T16:56:47.231Z

| Name | Metric | Value | Unit |
|------|--------|------:|------|
| 10 entities | search_latency_avg | 60.92 | ms |
| 10 entities | index_rebuild_time | 13.99 | ms |
| 10 entities | heap_used_mb | 24.72 | MB |
| 50 entities | search_latency_avg | 141.94 | ms |
| 50 entities | index_rebuild_time | 19.47 | ms |
| 50 entities | heap_used_mb | 24.72 | MB |
| 100 entities | search_latency_avg | 233.69 | ms |
| 100 entities | index_rebuild_time | 17.34 | ms |
| 100 entities | heap_used_mb | 31.07 | MB |
| 500 entities | search_latency_avg | 588.67 | ms |
| 500 entities | index_rebuild_time | 19.42 | ms |
| 500 entities | heap_used_mb | 31.07 | MB |
| 1000 entities | search_latency_avg | 959.95 | ms |
| 1000 entities | index_rebuild_time | 18.83 | ms |
| 1000 entities | heap_used_mb | 38.19 | MB |
| Degradation | performance_ceiling | 959.95 | ms |

**Summary**: Tested 10, 50, 100, 500, 1000 entities. Degradation: none detected. Max latency: 960.0ms at 1000 entities.

---

## Layer Comparison

*Ablation study comparing Wiki-only, Search-only, and Hybrid approaches*

Started: 2026-04-08T16:56:47.425Z | Completed: 2026-04-08T16:57:07.320Z

| Name | Metric | Value | Unit |
|------|--------|------:|------|
| Wiki Only (Karpathy) | recall | 16.50 | % |
| Wiki Only (Karpathy) | precision | 100 | % |
| Wiki Only (Karpathy) | avg_tokens | 199 | tokens |
| Wiki Only (Karpathy) | token_p95 | 257.05 | tokens |
| Search Only (RAG/MemPalace) | recall | 0 | % |
| Search Only (RAG/MemPalace) | precision | 100 | % |
| Search Only (RAG/MemPalace) | avg_tokens | 21 | tokens |
| Search Only (RAG/MemPalace) | token_p95 | 21 | tokens |
| Hybrid (DevContext) | recall | 49.50 | % |
| Hybrid (DevContext) | precision | 100 | % |
| Hybrid (DevContext) | avg_tokens | 216 | tokens |
| Hybrid (DevContext) | token_p95 | 307.05 | tokens |
| Hybrid vs Wiki Only | recall_delta | 33 | pp |
| Hybrid vs Search Only | recall_delta | 49.50 | pp |

**Summary**: Hybrid: 50% recall, 100% precision, 216 avg tokens. Wiki Only: 17% recall, 199 tokens. Search Only: 0% recall, 21 tokens. Hybrid recall advantage: +33pp vs wiki, +49.5pp vs search.

---
