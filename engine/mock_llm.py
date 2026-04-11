"""
Mock LLM filter for testing — returns deterministic filter results.

Used by tests to verify the LLM filtering pipeline without making
real API calls.
"""

from __future__ import annotations

import json
import math
from typing import Any


class MockLLMFilter:
    """Returns predictable, deterministic results for testing.

    Args:
        pass_rate: Fraction of candidates that pass as REAL (0.0–1.0).
                   Default 0.3 means ~30% survive filtering.
        noise_keywords: If a candidate text contains any of these,
                        it's always classified as NOISE regardless of pass_rate.
        real_keywords: If a candidate text contains any of these,
                       it's always classified as REAL regardless of pass_rate.
    """

    def __init__(
        self,
        pass_rate: float = 0.3,
        noise_keywords: list[str] | None = None,
        real_keywords: list[str] | None = None,
    ):
        self.pass_rate = max(0.0, min(1.0, pass_rate))
        self.noise_keywords = [k.lower() for k in (noise_keywords or [
            "template", "placeholder", "example code", "TODO",
            "snippet", "lorem ipsum", "test123",
        ])]
        self.real_keywords = [k.lower() for k in (real_keywords or [
            "decided", "architecture", "design", "chose",
            "WebSockets", "JWT", "migration",
        ])]
        self._call_count = 0
        self._call_log: list[dict] = []

    def classify(self, candidates: list[dict], category: str) -> list[dict]:
        """Classify candidates deterministically.

        First checks keyword overrides, then applies pass_rate positionally:
        the first ceil(N * pass_rate) candidates pass as REAL, rest are NOISE.

        Args:
            candidates: List of dicts with at least a 'text' key.
            category: One of 'decisions', 'patterns', 'people'.

        Returns:
            List of verdict dicts: [{text, verdict, reason}]
        """
        self._call_count += 1
        self._call_log.append({"category": category, "count": len(candidates)})

        results = []
        n_pass = math.ceil(len(candidates) * self.pass_rate)
        pass_count = 0

        for i, candidate in enumerate(candidates):
            text = candidate.get("text", str(candidate)) if isinstance(candidate, dict) else str(candidate)
            text_lower = text.lower()

            # Keyword overrides
            if any(kw in text_lower for kw in self.noise_keywords):
                results.append({
                    "text": text,
                    "verdict": "NOISE",
                    "reason": f"contains noise keyword ({category})",
                })
                continue

            if any(kw in text_lower for kw in self.real_keywords):
                results.append({
                    "text": text,
                    "verdict": "REAL",
                    "reason": f"contains real keyword ({category})",
                })
                pass_count += 1
                continue

            # Positional pass_rate
            if pass_count < n_pass:
                results.append({
                    "text": text,
                    "verdict": "REAL",
                    "reason": f"within pass rate ({category})",
                })
                pass_count += 1
            else:
                results.append({
                    "text": text,
                    "verdict": "NOISE",
                    "reason": f"exceeds pass rate ({category})",
                })

        return results

    def as_json_response(self, candidates: list[dict], category: str) -> str:
        """Return the classification as a JSON string (simulates raw LLM output)."""
        return json.dumps(self.classify(candidates, category))

    @property
    def call_count(self) -> int:
        return self._call_count

    @property
    def call_log(self) -> list[dict]:
        return list(self._call_log)

    def reset(self):
        """Reset call tracking state."""
        self._call_count = 0
        self._call_log = []

    def consolidate(self, entity_name: str, entity_type: str, timeline: str) -> str:
        """Return a mock consolidated compiled truth section.

        Args:
            entity_name: Name of the entity being consolidated.
            entity_type: Type of entity (project, person).
            timeline: Timeline text to summarize.

        Returns:
            Mock compiled truth text.
        """
        self._call_count += 1
        self._call_log.append({"category": "consolidation", "count": 1})
        return (
            f"{entity_name} is a {entity_type} actively being developed. "
            f"[Source: observed, session mock0001]\n"
            f"Key focus area based on recent activity. "
            f"[Source: observed, session mock0002]"
        )

    def consolidate(
        self,
        entity_name: str,
        entity_type: str,
        current_truth: str,
        timeline: str,
        raw_excerpts: str,
    ) -> str:
        """Return a deterministic consolidated compiled truth (for testing).

        Generates a simple summary referencing the entity name and timeline count.
        """
        self._call_count += 1
        self._call_log.append({"category": "consolidation", "count": 1})

        # Count timeline entries
        timeline_count = len([l for l in timeline.split("\n") if l.strip().startswith("- [")])
        return (
            f"{entity_name} is a {entity_type} with {timeline_count} timeline entries. "
            f"[Source: mock consolidation]"
        )

    def consolidate(self, entity_name: str, entity_type: str,
                    current_truth: str, timeline: str, raw_excerpts: str) -> str:
        """Return a mock consolidated compiled truth section.

        Simulates LLM consolidation for testing.
        """
        self._call_count += 1
        self._call_log.append({"category": "consolidation", "count": 1})

        # Build a deterministic summary from timeline entries
        lines = []
        for line in timeline.split("\n"):
            if line.strip().startswith("- ["):
                # Extract the content between date and session attribution
                match_line = line.strip()
                content = match_line.split("] ", 1)[-1] if "] " in match_line else match_line
                # Remove session attribution
                if "(session:" in content:
                    content = content[:content.rfind("(session:")].strip()
                if content and len(content) > 10:
                    lines.append(content[:100])

        if not lines:
            return current_truth

        summary = ". ".join(lines[:3])
        return f"{entity_name} — {summary}. [Source: observed, session mock]"
