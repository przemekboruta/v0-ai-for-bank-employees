# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Topic Discovery Hub — a full-stack application for automatic topic discovery and few-shot classification in Polish banking documents. The core value proposition: a custom domain-adapted encoder (CPT + fine-tuning for clustering and few-shot) powers all ML features — clustering, SetFit classification, semantic search. The goal is to demonstrate that investing in domain-specific encoder models delivers measurable business value.

**Two user personas:**
1. **Bank employee** (primary) — needs to understand what topics appear in incoming correspondence/complaints and build classifiers without ML knowledge. The tool should guide them step by step.
2. **Model creator** (secondary) — wants to showcase the encoder's capabilities (better clustering separation, better few-shot accuracy, semantic search quality) to justify continued investment.

## Tech Stack

- **Frontend**: Next.js 16 (React 19), TypeScript, Tailwind CSS, Shadcn/ui (Radix)
- **Backend**: Python 3.12+, FastAPI, PyTorch, sentence-transformers, SetFit, UMAP, HDBSCAN
- **Queue/Cache**: Redis 7 (job queue, embedding cache, result cache)
- **LLM**: OpenAI API via `instructor` library for structured outputs

## Commands

```bash
# Frontend dev (mock mode — no backend needed)
npm run dev

# Frontend dev (with backend)
PYTHON_BACKEND_URL=http://localhost:8000 npm run dev

# Build & lint
npm run build
npm run lint

# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Full stack via Docker
docker compose up --build
```

No automated test suites exist yet.

## Architecture

### Mode Switching

When `PYTHON_BACKEND_URL` is unset, the frontend uses mock data from `lib/mock-clustering.ts`. When set, Next.js API routes proxy requests to the Python backend via `lib/backend-proxy.ts`.

### Frontend

- **app/page.tsx**: Main wizard component — path-based flow: **full** (Discovery → Review → Promote → Categories → Training → Classification results), **classify-only** (Upload → Categories → Training → Results), **batch** (Upload → Results with pre-selected model).
- **components/wizard/**: Step components — StepUpload, StepConfigure, StepProcessing, StepReview, StepExplore, JobDashboard; **StepCategories** (taxonomy/categories), **StepTraining** (SetFit job poll), **StepClassificationResults** (classification output); **PromoteDialog** (import clusters to taxonomy), **ModelManager** (list/delete saved models).
- **lib/clustering-types.ts**: Single source of truth for all TypeScript types (synchronized with backend Pydantic schemas in `backend/schemas.py`). Includes: `WizardStep`, `WizardPath`, `CategoryDefinition`, `TaxonomyInfo`, `ClassificationResult`, `TrainingJobInfo`, `ModelInfo`.
- **lib/api-client.ts**: API abstraction layer: clustering jobs, taxonomy CRUD, createTaxonomy, addCategory, promoteClusters, submitTrainingJob, getTrainingStatus, predictWithModel, batchClassify, listModels, getModelInfo, deleteModel.
- **app/api/**: Next.js API routes that proxy to the Python backend (cluster, taxonomy, classify, models, health).

### Backend

- **backend/main.py**: FastAPI app with lifespan context manager for encoder preload; includes routers: cluster, export, health, **taxonomy**, **classification**.
- **backend/schemas.py**: Pydantic models matching frontend types (supports camelCase/snake_case alias conversion); includes taxonomy/classification: CategoryDefinition, TaxonomyInfo, TrainRequest, PredictRequest, TrainingJobInfo, ClassificationResult, ModelInfo.
- **backend/services/pipeline.py**: Orchestrator — coordinates the ML pipeline
- **backend/services/encoder.py**: EncoderService singleton (ModernBERT embeddings, auto device detection)
- **backend/services/clustering.py**: UMAP dimensionality reduction + HDBSCAN clustering, silhouette scores, TF-IDF keywords
- **backend/services/llm.py**: OpenAI integration for label generation and refinement suggestions
- **backend/services/job_queue.py**: Redis-based async job management with embedding cache
- **backend/services/taxonomy_service.py**: Redis-backed CRUD for taxonomies and categories; import from clustering result (promote clusters); import from templates.
- **backend/services/setfit_service.py**: SetFit training (few-shot), prediction, save/load models (filesystem + metadata).
- **backend/services/model_registry.py**: Redis registry of saved SetFit models (modelId, name, backbone, categories, accuracy).
- **backend/routers/cluster.py**: All clustering endpoints (submit, poll, recluster, refine, merge, split, rename, reclassify)
- **backend/routers/taxonomy.py**: Taxonomy and category CRUD; import-clusters; import-template.
- **backend/routers/classification.py**: POST /classify (training job), GET /classify/job/{id}, POST /classify/predict, POST /classify/batch; GET/DELETE /models, GET /models/{id}.
- **backend/config.py**: All configuration via environment variables; granularity presets; **SETFIT_***, **MODELS_DIR**, **TAXONOMY_TTL**, **LOCAL_ENCODER_PATH**.

### Data Flow

**Clustering (discovery):**
```
CSV/JSON upload → Next.js API route → Python backend → Redis queue (async)
→ Pipeline: Encoder (domain-adapted) → UMAP → HDBSCAN → Coherence → Keywords → LLM labels
→ Result cached in Redis (48h TTL) → Frontend polls job status → Display in wizard
```

**Classification (SetFit few-shot):**
```
Taxonomy/categories (name + examples) → POST /api/classify → Redis job → SetFit train (encoder backbone)
→ Model saved to MODELS_DIR, metadata in ModelRegistry (Redis) → Optional predict on uploaded texts
→ Frontend polls GET /api/classify/job/{id} → StepClassificationResults. Batch: POST /api/classify/batch with modelId.
```

**Planned: Active Learning loop:**
```
Classification results → User reviews low-confidence predictions → Corrects labels
→ Corrections become new training examples → Retrain model → Improved accuracy
```

### Key Type Contracts

TypeScript types in `lib/clustering-types.ts` and Pydantic models in `backend/schemas.py` must stay synchronized. Key types: `ClusteringConfig`, `ClusterTopic`, `LLMSuggestion`, `ClusteringResult`, `JobInfo`; **CategoryDefinition**, **TaxonomyInfo**, **ClassificationResult**, **TrainingJobInfo**, **ModelInfo**, **WizardStep**, **WizardPath**.

## Known Issues (Faza 0 in TODO.md)

- Explore step has no forward navigation in full path (missing from `canGoNext` and step indicator)
- Batch dashboard card has empty onClick handler
- `onSaveModel` never passed to StepClassificationResults
- Advanced reclassify dropdowns not wired (no onChange handlers)
- Silent failure when taxonomy creation fails (no user feedback)
- SetFit accuracy is in-sample only (evaluates on training data)
- Category edits in StepCategories not persisted to Redis
- `predict_proba` fallback gives all docs confidence=1.0 without warning

## Development Roadmap

See `TODO.md` for the full prioritized plan. Summary:
- **Faza 0**: Fix existing bugs (navigation, wiring, accuracy metric, persistence)
- **Faza 1**: Guided UX for non-technical users (onboarding, tooltips, simplified views)
- **Faza 2**: Active Learning loop (feedback on low-confidence predictions, iterative retraining)
- **Faza 3**: Encoder showcase (semantic search, near-duplicate detection, encoder comparison)
- **Faza 4**: Production readiness (async queue hardening, API auth, user management)
- **Faza 5**: Technical refactor (reusable components, proper validation split, tests, i18n)

## Environment Variables

Backend configuration is in `backend/.env` (see `backend/.env.example`). Key vars:
- `OPENAI_API_KEY` — required for LLM labeling
- `ENCODER_MODEL_NAME` — defaults to `answerdotai/ModernBERT-base`
- `LLM_MODEL` — defaults to `gpt-4o`
- `REDIS_URL` — defaults to `redis://localhost:6379/0`
- `CORS_ORIGINS` — defaults to `http://localhost:3000`
- `SETFIT_NUM_ITERATIONS`, `SETFIT_BATCH_SIZE` — SetFit training
- `MODELS_DIR` — directory for saved SetFit models (default: `backend/saved_models`)
- `TAXONOMY_TTL` — Redis TTL for taxonomy data (default 30 days)
- `LOCAL_ENCODER_PATH` — optional path to custom encoder for SetFit backbone

## Path Aliases

TypeScript uses `@/*` mapped to the project root (e.g., `@/components/ui/button`, `@/lib/utils`).

## Conventions

- All UI text in Polish (no diacritics in code comments/identifiers)
- Pydantic models use `Field(alias="camelCase")` + `populate_by_name = True`
- Proxy routes: check `isPythonBackendEnabled()`, return 503 if backend required but absent
- Classification features require backend (no mock mode)
- Templates stored in `backend/templates/*.json`

## Documentation

- `README.md` and `BACKEND_ARCHITECTURE.md` are in Polish
- `TODO.md` — prioritized development roadmap with phases
- `LLM_SUGGESTIONS_PROPOSAL.md` describes planned suggestion types (DELETE, EXTRACT, CONSOLIDATE, etc.)
