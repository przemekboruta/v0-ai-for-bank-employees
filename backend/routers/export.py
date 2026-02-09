"""
Topic Discovery Hub - Export Router
Endpoint: POST /cluster/export
Generuje raporty w formatach: text, csv, json
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

from schemas import ExportRequest, ErrorResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cluster", tags=["export"])


@router.post(
    "/export",
    responses={400: {"model": ErrorResponse}},
    summary="Eksportuj wyniki klasteryzacji",
    description="Generuje raport w formacie text, CSV lub JSON.",
)
async def export_results(req: ExportRequest):
    result = req.result

    if not result.topics or not result.documents:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "Wynik klasteryzacji musi zawierac topiki i dokumenty.",
            },
        )

    topics_data = [t.model_dump(by_alias=True) for t in result.topics]
    docs_data = [d.model_dump(by_alias=True) for d in result.documents]
    suggestions_data = [s.model_dump(by_alias=True) for s in result.llm_suggestions]
    pl = req.language == "pl"

    # ===== CSV =====
    if req.format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id", "tekst", "kategoria", "id_kategorii", "koherencja_kategorii"])

        topic_map = {t["id"]: t for t in topics_data}
        for doc in docs_data:
            topic = topic_map.get(doc["clusterId"])
            writer.writerow([
                doc["id"],
                doc["text"],
                topic["label"] if topic else "",
                doc["clusterId"],
                f"{round(topic['coherenceScore'] * 100)}%" if topic else "",
            ])

        csv_content = output.getvalue()
        return StreamingResponse(
            io.BytesIO(csv_content.encode("utf-8-sig")),  # BOM dla Excela
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=klasteryzacja_wyniki.csv"},
        )

    # ===== JSON =====
    if req.format == "json":
        export_data = {
            "metadata": {
                "exportDate": datetime.now(timezone.utc).isoformat(),
                "totalDocuments": result.total_documents,
                "totalTopics": len(topics_data),
                "noiseDocuments": result.noise,
                "language": req.language,
            },
            "topics": [
                {
                    "id": t["id"],
                    "label": t["label"],
                    "description": t["description"],
                    "documentCount": t["documentCount"],
                    "coherenceScore": t["coherenceScore"],
                    "keywords": t["keywords"],
                    **({"sampleTexts": t["sampleTexts"]} if req.include_examples else {}),
                }
                for t in topics_data
            ],
            "documents": [
                {
                    "id": d["id"],
                    "text": d["text"],
                    "clusterId": d["clusterId"],
                    "clusterLabel": next(
                        (t["label"] for t in topics_data if t["id"] == d["clusterId"]),
                        "N/A",
                    ),
                }
                for d in docs_data
            ],
        }

        if req.include_llm_insights and suggestions_data:
            export_data["llmInsights"] = {
                "appliedSuggestions": sum(1 for s in suggestions_data if s.get("applied")),
                "pendingSuggestions": sum(1 for s in suggestions_data if not s.get("applied")),
                "suggestions": suggestions_data,
            }

        return JSONResponse(content=export_data)

    # ===== TEXT =====
    lines: list[str] = []

    lines.append("RAPORT KLASTERYZACJI TEMATYCZNEJ" if pl else "TOPIC CLUSTERING REPORT")
    lines.append("=" * 50)
    lines.append("")
    lines.append(f"{'Data' if pl else 'Date'}: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append(f"{'Liczba dokumentow' if pl else 'Documents'}: {result.total_documents}")
    lines.append(f"{'Wykryte kategorie' if pl else 'Topics found'}: {len(topics_data)}")
    lines.append(f"{'Dokumenty nieskategoryzowane' if pl else 'Noise'}: {result.noise}")
    lines.append("")
    lines.append("WYKRYTE KATEGORIE:" if pl else "DISCOVERED TOPICS:")
    lines.append("-" * 50)
    lines.append("")

    sorted_topics = sorted(topics_data, key=lambda t: t["documentCount"], reverse=True)
    for idx, topic in enumerate(sorted_topics):
        pct = round(topic["documentCount"] / result.total_documents * 100, 1)
        lines.append(f"{idx + 1}. {topic['label']}")
        lines.append(f"   {'Dokumentow' if pl else 'Documents'}: {topic['documentCount']} ({pct}%)")
        lines.append(f"   {'Koherencja' if pl else 'Coherence'}: {round(topic['coherenceScore'] * 100)}%")
        lines.append(f"   {'Opis' if pl else 'Description'}: {topic['description']}")
        lines.append(f"   {'Slowa kluczowe' if pl else 'Keywords'}: {', '.join(topic['keywords'])}")
        lines.append("")

    if req.include_examples:
        lines.append("PRZYKLADY Z KAZDEJ KATEGORII:" if pl else "EXAMPLES FROM EACH TOPIC:")
        lines.append("-" * 50)
        lines.append("")
        for topic in sorted_topics:
            lines.append(f"[{topic['label']}]")
            for s in topic.get("sampleTexts", []):
                lines.append(f"  - {s}")
            lines.append("")

    if req.include_llm_insights and suggestions_data:
        lines.append("SUGESTIE AI:" if pl else "AI SUGGESTIONS:")
        lines.append("-" * 50)
        lines.append("")
        for idx, s in enumerate(suggestions_data):
            status = "[ZASTOSOWANA]" if s.get("applied") else "[OCZEKUJACA]"
            lines.append(f"{idx + 1}. {status} {s['description']}")
            lines.append(f"   {'Pewnosc' if pl else 'Confidence'}: {round(s['confidence'] * 100)}%")
            lines.append("")

    report_text = "\n".join(lines)

    return StreamingResponse(
        io.BytesIO(report_text.encode("utf-8")),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=raport_klasteryzacji.txt"},
    )
