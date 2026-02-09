"""
LLM Service - OpenAI integration
Labelowanie klastrow, generowanie sugestii refinementu, opisy po polsku.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

from openai import AsyncOpenAI

from config import (
    OPENAI_API_KEY,
    LLM_MODEL,
    LLM_TEMPERATURE,
    LLM_MAX_TOKENS,
    LLM_RETRY_COUNT,
)

logger = logging.getLogger(__name__)

# ===== Prompty =====

LABELING_SYSTEM_PROMPT = """\
Jestes ekspertem od analizy tekstu w polskim sektorze bankowym.
Analizujesz grupy tekstow (klastry) z contact center bankowego.
Dla kazdej grupy musisz:
1. Nadac krotka, opisowa nazwe kategorii (max 5 slow, po polsku)
2. Napisac 1-zdaniowy opis kategorii
3. Nie uzywac zbyt ogolnych nazw jak "Rozne" czy "Inne"
4. Odpowiedz WYLACZNIE poprawnym JSON-em, bez dodatkowego tekstu\
"""

LABELING_USER_PROMPT = """\
Klaster {cluster_id} ({doc_count} dokumentow, koherencja: {coherence}%):

Reprezentatywne teksty:
{samples}

Slowa kluczowe TF-IDF: {keywords}

Podaj etykiete i opis w formacie JSON:
{{"label": "...", "description": "..."}}\
"""

REFINEMENT_SYSTEM_PROMPT = """\
Jestes ekspertem od optymalizacji kategoryzacji tekstu.
Przegladasz wynik klasteryzacji dokumentow z contact center bankowego.
Twoim zadaniem jest zaproponowanie ulepszen, takich jak:

1. MERGE (polaczenie) - jezeli dwa klastry sa bardzo podobne tematycznie
2. SPLIT (podzial) - jezeli klaster ma wyraznie dwie podgrupy tematyczne
3. RENAME (zmiana nazwy) - jezeli nazwa jest niejasna lub nieadekwatna
4. RECLASSIFY (reklasyfikacja) - jezeli czesc dokumentow lepiej pasuje do innego klastra

Kazdej sugestii przypisz confidence (0.0 do 1.0). Podaj max 5 sugestii.
Odpowiedz WYLACZNIE poprawnym JSON array, bez dodatkowego tekstu.\
"""

REFINEMENT_USER_PROMPT = """\
Wynik klasteryzacji ({total_docs} dokumentow, {num_clusters} klastrow):

{clusters_description}

Dokumenty nieskategoryzowane (szum): {noise_count}

{focus_section}

{previous_section}

Zaproponuj ulepszenia. Odpowiedz jako JSON array:
[
  {{
    "type": "merge|split|rename|reclassify",
    "description": "opis sugestii po polsku",
    "targetClusterIds": [id1, id2],
    "suggestedLabel": "opcjonalnie nowa nazwa",
    "confidence": 0.82
  }}
]\
"""


class LLMService:
    """
    Serwis LLM oparty o OpenAI API.
    Odpowiada za labelowanie klastrow i generowanie sugestii refinementu.
    """

    def __init__(self) -> None:
        self.client: AsyncOpenAI | None = None
        self.model = LLM_MODEL
        self.temperature = LLM_TEMPERATURE
        self.max_tokens = LLM_MAX_TOKENS
        self.retry_count = LLM_RETRY_COUNT

    def _ensure_client(self) -> None:
        if self.client is None:
            if not OPENAI_API_KEY:
                raise RuntimeError(
                    "OPENAI_API_KEY nie jest ustawiony. "
                    "Ustaw zmienna srodowiskowa lub dodaj do .env"
                )
            self.client = AsyncOpenAI(api_key=OPENAI_API_KEY)

    async def _call_llm(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> str:
        """
        Wywoluje OpenAI API z retry i error handling.
        """
        self._ensure_client()

        for attempt in range(self.retry_count):
            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_format={"type": "json_object"},
                )
                content = response.choices[0].message.content
                if content:
                    return content.strip()
                raise ValueError("Pusta odpowiedz od LLM")

            except Exception as e:
                logger.warning(
                    f"LLM attempt {attempt + 1}/{self.retry_count} failed: {e}"
                )
                if attempt < self.retry_count - 1:
                    await asyncio.sleep(2 ** attempt)  # Exponential backoff
                else:
                    raise

        raise RuntimeError("LLM: wszystkie proby wyczerpane")

    def _parse_json(self, text: str, fallback: dict | list | None = None):
        """Bezpieczne parsowanie JSON z fallbackiem."""
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Probuj wyciagnac JSON z tekstu
            for start_char, end_char in [("{", "}"), ("[", "]")]:
                start = text.find(start_char)
                end = text.rfind(end_char)
                if start != -1 and end != -1 and end > start:
                    try:
                        return json.loads(text[start : end + 1])
                    except json.JSONDecodeError:
                        continue
            logger.error(f"Nie udalo sie sparsowac JSON: {text[:200]}")
            return fallback

    async def label_cluster(
        self,
        cluster_id: int,
        doc_count: int,
        coherence: float,
        sample_texts: list[str],
        keywords: list[str],
    ) -> dict:
        """
        Generuje etykiete i opis dla jednego klastra.

        Returns:
            {"label": "...", "description": "..."}
        """
        samples_text = "\n".join(
            f'{i + 1}. "{text}"' for i, text in enumerate(sample_texts[:5])
        )
        keywords_text = ", ".join(keywords[:7])

        user_prompt = LABELING_USER_PROMPT.format(
            cluster_id=cluster_id,
            doc_count=doc_count,
            coherence=int(coherence * 100),
            samples=samples_text,
            keywords=keywords_text,
        )

        try:
            result_text = await self._call_llm(LABELING_SYSTEM_PROMPT, user_prompt)
            parsed = self._parse_json(result_text, {"label": f"Klaster {cluster_id}", "description": ""})
            return {
                "label": parsed.get("label", f"Klaster {cluster_id}"),
                "description": parsed.get("description", ""),
            }
        except Exception as e:
            logger.error(f"LLM labeling failed for cluster {cluster_id}: {e}")
            # Fallback: uzyj keywords jako nazwy
            fallback_label = ", ".join(keywords[:3]).capitalize() if keywords else f"Klaster {cluster_id}"
            return {
                "label": fallback_label,
                "description": f"Automatycznie wykryta kategoria ({doc_count} dokumentow)",
            }

    async def label_all_clusters(
        self,
        topics: list[dict],
    ) -> list[dict]:
        """
        Rownolegle labeluje wszystkie klastry.
        Modyfikuje topics in-place dodajac label i description.
        """
        logger.info(f"Labelowanie {len(topics)} klastrow przez LLM...")
        start = time.time()

        tasks = [
            self.label_cluster(
                cluster_id=topic["id"],
                doc_count=topic["documentCount"],
                coherence=topic["coherenceScore"],
                sample_texts=topic["sampleTexts"],
                keywords=topic["keywords"],
            )
            for topic in topics
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        for topic, result in zip(topics, results):
            if isinstance(result, Exception):
                logger.error(f"Labeling error for cluster {topic['id']}: {result}")
                topic["label"] = f"Klaster {topic['id']}"
                topic["description"] = "Blad generowania etykiety"
            else:
                topic["label"] = result["label"]
                topic["description"] = result["description"]

        elapsed = time.time() - start
        logger.info(f"Labelowanie zakonczone w {elapsed:.1f}s")
        return topics

    async def generate_refinement_suggestions(
        self,
        topics: list[dict],
        total_docs: int,
        noise_count: int,
        focus_areas: list[str] | None = None,
        previous_suggestions: list[dict] | None = None,
    ) -> dict:
        """
        Generuje sugestie refinementu na podstawie przegladu wszystkich klastrow.

        Returns:
            {
                "suggestions": [...],
                "analysis": {
                    "overallCoherence": float,
                    "problematicClusters": [...],
                    "suggestedOptimalK": int
                }
            }
        """
        # Zbuduj opis klastrow
        clusters_lines = []
        coherence_values = []
        problematic = []

        for topic in topics:
            coherence = topic.get("coherenceScore", 0.5)
            coherence_values.append(coherence)
            if coherence < 0.5:
                problematic.append(topic["id"])

            samples = topic.get("sampleTexts", [])[:3]
            samples_text = "\n  ".join(f'- "{s}"' for s in samples)
            keywords = ", ".join(topic.get("keywords", []))

            clusters_lines.append(
                f"Klaster {topic['id']}: \"{topic['label']}\" "
                f"({topic['documentCount']} dok., koherencja: {int(coherence * 100)}%)\n"
                f"  Opis: {topic.get('description', 'brak')}\n"
                f"  Slowa kluczowe: {keywords}\n"
                f"  Przykladowe teksty:\n  {samples_text}"
            )

        clusters_description = "\n\n".join(clusters_lines)

        # Focus areas
        focus_section = ""
        if focus_areas:
            focus_map = {
                "coherence": "spojnosc klastrow (szukaj niespojnych)",
                "granularity": "poziom szczegolowosci (za duzo/za malo klastrow?)",
                "naming": "jakosc nazw kategorii",
                "outliers": "dokumenty nieskategoryzowane i potencjalne reklasyfikacje",
            }
            focus_items = [focus_map.get(f, f) for f in focus_areas]
            focus_section = f"Skup sie szczegolnie na: {', '.join(focus_items)}"

        # Previous suggestions
        previous_section = ""
        if previous_suggestions:
            prev_lines = [
                f"- [{s.get('type', '?')}] {s.get('description', '')}"
                for s in previous_suggestions
            ]
            previous_section = (
                "Ponizsze sugestie zostaly juz wczesniej zaproponowane "
                "(NIE powtarzaj ich):\n" + "\n".join(prev_lines)
            )

        user_prompt = REFINEMENT_USER_PROMPT.format(
            total_docs=total_docs,
            num_clusters=len(topics),
            clusters_description=clusters_description,
            noise_count=noise_count,
            focus_section=focus_section,
            previous_section=previous_section,
        )

        try:
            result_text = await self._call_llm(
                REFINEMENT_SYSTEM_PROMPT, user_prompt
            )
            parsed = self._parse_json(result_text, [])

            # Normalizuj - moze byc {"suggestions": [...]} lub [...]
            if isinstance(parsed, dict):
                suggestions_raw = parsed.get("suggestions", parsed.get("items", []))
            elif isinstance(parsed, list):
                suggestions_raw = parsed
            else:
                suggestions_raw = []

            # Walidacja i normalizacja sugestii
            suggestions = []
            for s in suggestions_raw[:5]:
                suggestion_type = s.get("type", "rename")
                if suggestion_type not in ("merge", "split", "rename", "reclassify"):
                    continue

                suggestions.append({
                    "type": suggestion_type,
                    "description": s.get("description", ""),
                    "targetClusterIds": s.get("targetClusterIds", []),
                    "suggestedLabel": s.get("suggestedLabel"),
                    "confidence": max(0.0, min(1.0, float(s.get("confidence", 0.5)))),
                    "applied": False,
                })

        except Exception as e:
            logger.error(f"LLM refinement failed: {e}")
            suggestions = []

        # Oblicz analize
        overall_coherence = (
            sum(coherence_values) / len(coherence_values)
            if coherence_values
            else 0.0
        )

        return {
            "suggestions": suggestions,
            "analysis": {
                "overallCoherence": round(overall_coherence, 3),
                "problematicClusters": problematic,
                "suggestedOptimalK": max(2, len(topics)),
                "focusAreasAnalyzed": focus_areas or [],
            },
        }

    async def health_check(self) -> dict:
        """Sprawdza status serwisu LLM."""
        if not OPENAI_API_KEY:
            return {
                "status": "not_configured",
                "model": self.model,
                "error": "OPENAI_API_KEY not set",
            }

        try:
            self._ensure_client()
            start = time.time()
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=5,
            )
            latency = int((time.time() - start) * 1000)
            return {
                "status": "up",
                "model": self.model,
                "latencyMs": latency,
            }
        except Exception as e:
            return {
                "status": "error",
                "model": self.model,
                "error": str(e),
            }
