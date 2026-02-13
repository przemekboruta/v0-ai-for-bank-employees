"""
LLM Service - OpenAI integration with Instructor
Labelowanie klastrow, generowanie sugestii refinementu, opisy po polsku.
Uzywa instructor do structured outputs z modelami Pydantic.
"""

from __future__ import annotations

import asyncio
import logging
import time

import instructor
from openai import AsyncOpenAI

from config import (
    OPENAI_API_KEY,
    LLM_BASE_URL,
    LLM_MODEL,
    LLM_TEMPERATURE,
    LLM_MAX_TOKENS,
    LLM_RETRY_COUNT,
)
from schemas import (
    ClusterLabelResponse,
    RefinementSuggestionsResponse,
    LLMSuggestion,
    RefineAnalysis,
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

1. MERGE (polaczenie) - jezeli dwa lub wiecej klastrow sa bardzo podobne tematycznie
2. RENAME (zmiana nazwy) - jezeli nazwa jest niejasna lub nieadekwatna
3. RECLASSIFY (reklasyfikacja) - jezeli jeden lub wiecej klastrow powinno byc podzielonych na mniejsze, bardziej spójne grupy

Kazdej sugestii przypisz confidence (0.0 do 1.0). Podaj max 5 sugestii.

Dodatkowo przeprowadz analize klasteryzacji:
- Oblicz srednia koherencje wszystkich klastrow
- Zidentyfikuj problematyczne klastry (koherencja < 0.5)
- Zaproponuj optymalna liczbe klastrow na podstawie analizy

Odpowiedz uzywajac strukturyzowanego formatu zgodnego z modelem Pydantic.\
"""

REFINEMENT_USER_PROMPT = """\
Wynik klasteryzacji ({total_docs} dokumentow, {num_clusters} klastrow):

{clusters_description}

Dokumenty nieskategoryzowane (szum): {noise_count}

Srednia koherencja wszystkich klastrow: {avg_coherence:.1%}
Problematyczne klastry (koherencja < 50%): {problematic_clusters}

{focus_section}

{previous_section}

Zaproponuj ulepszenia (max 5 sugestii) oraz przeprowadz analize klasteryzacji.
Dla kazdej sugestii podaj:
- type: "merge" | "rename" | "reclassify"
- description: opis sugestii po polsku
- targetClusterIds: lista ID klastrow dotknietych sugestia
  * dla reclassify: [clusterId1, clusterId2, ...] - lista klastrow do reklasyfikacji (będą podzielone na nowe)
  * dla merge: [clusterId1, clusterId2, ...] - lista klastrow do polaczenia
  * dla rename: [clusterId] - pojedynczy klaster do przemianowania
- suggestedLabel: opcjonalnie nowa nazwa (dla rename/merge)
- confidence: wartosc od 0.0 do 1.0

W analizie podaj:
- overallCoherence: srednia koherencja wszystkich klastrow (0.0-1.0)
- problematicClusters: lista ID klastrow z niska koherencja (< 0.5)
- suggestedOptimalK: sugerowana optymalna liczba klastrow
- focusAreasAnalyzed: lista obszarow na ktorych sie skupiles\
"""


class LLMService:
    """
    Serwis LLM oparty o OpenAI API z Instructor.
    Odpowiada za labelowanie klastrow i generowanie sugestii refinementu.
    Uzywa structured outputs z modelami Pydantic.
    """

    def __init__(self) -> None:
        self.client: AsyncOpenAI | None = None
        self.instructor_client: instructor.Instructor | None = None
        self.model = LLM_MODEL
        self.temperature = LLM_TEMPERATURE
        self.max_tokens = LLM_MAX_TOKENS
        self.retry_count = LLM_RETRY_COUNT

    def _ensure_client(self) -> None:
        if self.client is None:
            if not OPENAI_API_KEY:
                raise RuntimeError("OPENAI_API_KEY nie jest ustawiony. " "Ustaw zmienna srodowiskowa lub dodaj do .env")
            client_kwargs: dict = {"api_key": OPENAI_API_KEY}
            if LLM_BASE_URL:
                client_kwargs["base_url"] = LLM_BASE_URL
            self.client = AsyncOpenAI(**client_kwargs)
            # Create instructor client for structured outputs
            self.instructor_client = instructor.from_openai(self.client)

    async def _call_llm_structured(
        self,
        response_model: type,
        system_prompt: str,
        user_prompt: str,
    ):
        """
        Wywoluje OpenAI API z structured output przez Instructor.
        Automatycznie parsuje odpowiedz do modelu Pydantic.
        """
        self._ensure_client()
        if self.instructor_client is None:
            raise RuntimeError("Instructor client not initialized")

        for attempt in range(self.retry_count):
            try:
                response = await self.instructor_client.chat.completions.create(
                    model=self.model,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_model=response_model,
                )
                return response

            except Exception as e:
                logger.warning(f"LLM attempt {attempt + 1}/{self.retry_count} failed: {e}")
                if attempt < self.retry_count - 1:
                    await asyncio.sleep(2**attempt)  # Exponential backoff
                else:
                    raise

        raise RuntimeError("LLM: wszystkie proby wyczerpane")

    async def label_cluster(
        self,
        cluster_id: int,
        doc_count: int,
        coherence: float,
        sample_texts: list[str],
        keywords: list[str],
    ) -> dict:
        """
        Generuje etykiete i opis dla jednego klastra uzywajac Instructor.

        Returns:
            {"label": "...", "description": "..."}
        """
        samples_text = "\n".join(f'{i + 1}. "{text}"' for i, text in enumerate(sample_texts[:8]))
        keywords_text = ", ".join(keywords[:7])

        user_prompt = LABELING_USER_PROMPT.format(
            cluster_id=cluster_id,
            doc_count=doc_count,
            coherence=int(coherence * 100),
            samples=samples_text,
            keywords=keywords_text,
        )

        try:
            response = await self._call_llm_structured(
                ClusterLabelResponse,
                LABELING_SYSTEM_PROMPT,
                user_prompt,
            )
            return {
                "label": response.label,
                "description": response.description,
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
            prev_lines = [f"- [{s.get('type', '?')}] {s.get('description', '')}" for s in previous_suggestions]
            previous_section = (
                "Ponizsze sugestie zostaly juz wczesniej zaproponowane "
                "(NIE powtarzaj ich):\n" + "\n".join(prev_lines)
            )

        # Calculate average coherence for prompt
        avg_coherence = sum(coherence_values) / len(coherence_values) if coherence_values else 0.0
        problematic_clusters_str = ", ".join(map(str, problematic)) if problematic else "brak"

        user_prompt = REFINEMENT_USER_PROMPT.format(
            total_docs=total_docs,
            num_clusters=len(topics),
            clusters_description=clusters_description,
            noise_count=noise_count,
            avg_coherence=avg_coherence,
            problematic_clusters=problematic_clusters_str,
            focus_section=focus_section,
            previous_section=previous_section,
        )

        try:
            # Use instructor for structured output
            response = await self._call_llm_structured(
                RefinementSuggestionsResponse,
                REFINEMENT_SYSTEM_PROMPT,
                user_prompt,
            )

            # Convert Pydantic models to dict format
            suggestions = []
            for suggestion in response.suggestions[:5]:
                suggestion_dict = {
                    "type": suggestion.type,
                    "description": suggestion.description,
                    "targetClusterIds": suggestion.target_cluster_ids,
                    "suggestedLabel": suggestion.suggested_label,
                    "confidence": suggestion.confidence,
                    "applied": suggestion.applied,
                }
                suggestions.append(suggestion_dict)

            # Use analysis from LLM response
            analysis = {
                "overallCoherence": response.analysis.overall_coherence,
                "problematicClusters": response.analysis.problematic_clusters,
                "suggestedOptimalK": response.analysis.suggested_optimal_k,
                "focusAreasAnalyzed": response.analysis.focus_areas_analyzed,
            }

            return {
                "suggestions": suggestions,
                "analysis": analysis,
            }

        except Exception as e:
            logger.error(f"LLM refinement failed: {e}")
            # Fallback: calculate basic analysis
            overall_coherence = sum(coherence_values) / len(coherence_values) if coherence_values else 0.0
            return {
                "suggestions": [],
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
