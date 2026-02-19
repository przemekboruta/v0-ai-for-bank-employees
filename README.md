# Topic Discovery Hub

Aplikacja do automatycznego odkrywania tematów w dokumentach tekstowych (np. z contact center bankowego): embeddingi, redukcja wymiarów, klasteryzacja HDBSCAN, etykiety i sugestie generowane przez LLM. Dodatkowo: **taksonomie kategorii**, **trening modeli SetFit** (klasyfikacja few-shot) oraz **batch classification** zapisanymi modelami.

## Wymagania

- **Node.js** (frontend Next.js)
- **Python 3.10+** (backend FastAPI)
- **Redis** (kolejka zadań, cache embeddingów)

## Struktura projektu

- `app/` — frontend Next.js (React)
- `backend/` — API FastAPI, encoder (ModernBERT), pipeline klasteryzacji, integracja LLM, serwisy taksonomii i klasyfikacji SetFit
- `components/` — komponenty UI (wizard wielościeżkowy: discovery, kategorie, trening, wyniki)

## Konfiguracja

### Backend (zmienne środowiskowe)

Plik `backend/.env` (wzoruj się na `backend/.env.example`):

| Zmienna | Opis | Domyślnie |
|--------|------|-----------|
| **OPENAI_API_KEY** | Klucz API do modelu OpenAI (lub kompatybilnego) | — |
| **LLM_BASE_URL** | Opcjonalny URL endpointu LLM. Gdy pusty — używany jest domyślny endpoint OpenAI. Ustaw np. dla Azure OpenAI, proxy lub lokalnego serwera kompatybilnego z OpenAI API. | *(pusty)* |
| **LLM_MODEL** | Nazwa modelu (np. `gpt-4o`, `gpt-4`) | `gpt-4o` |
| **LLM_TEMPERATURE** | Temperatura generowania | `0.3` |
| **LLM_MAX_TOKENS** | Maks. liczba tokenów w odpowiedzi | `2000` |
| **ENCODER_MODEL_NAME** | Model do embeddingów (Hugging Face) | `answerdotai/ModernBERT-base` |
| **REDIS_URL** | Adres Redis | `redis://localhost:6379/0` |
| **HOST** | Host serwera API | `0.0.0.0` |
| **PORT** | Port serwera API | `8000` |
| **CORS_ORIGINS** | Dozwolone originy CORS (po przecinku) | `http://localhost:3000` |
| **SETFIT_NUM_ITERATIONS** | Liczba iteracji treningu SetFit | `20` |
| **SETFIT_BATCH_SIZE** | Batch size treningu SetFit | `16` |
| **MODELS_DIR** | Katalog zapisanych modeli SetFit | `backend/saved_models` |
| **TAXONOMY_TTL** | TTL taksonomii w Redis (sekundy) | `2592000` (30 dni) |
| **LOCAL_ENCODER_PATH** | Opcjonalna ścieżka do fine-tuned encodera dla SetFit | *(pusty)* |

Przykład użycia własnego endpointu LLM (np. Azure lub proxy):

```bash
LLM_BASE_URL=https://twoja-instancja.openai.azure.com/openai/deployments/twoja-deployment
OPENAI_API_KEY=twój-klucz
LLM_MODEL=gpt-4o
```

### Frontend

Frontend domyślnie łączy się z backendem pod adresem `http://localhost:8000`. Adres API można skonfigurować w zmiennych środowiskowych Next.js (np. `NEXT_PUBLIC_API_URL`), jeśli taki jest zdefiniowany w projekcie.

## Uruchomienie

### 1. Redis

Upewnij się, że Redis działa lokalnie lub ustaw `REDIS_URL` w `backend/.env`.

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edytuj .env — uzupełnij OPENAI_API_KEY (i opcjonalnie LLM_BASE_URL)
./run.sh
```

Albo ręcznie:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

API: <http://localhost:8000>  
Dokumentacja Swagger: <http://localhost:8000/docs>  
Health: <http://localhost:8000/api/health>

### 3. Frontend

```bash
npm install
npm run dev
```

Aplikacja: <http://localhost:3000>

## Przepływy w aplikacji

- **Discovery (pełny)** — Upload → Konfiguracja → Analiza → Przegląd → (opcjonalnie) Kategorie → Trening SetFit → Wyniki klasyfikacji. Odkrywanie tematów + budowanie taksonomii z klastrów i trening modelu.
- **Tylko klasyfikacja** — Upload → Kategorie (ręcznie lub z szablonu) → Trening → Wyniki. Definiowanie kategorii z przykładami i trening SetFit bez wcześniejszej klasteryzacji.
- **Batch** — Wybór zapisanego modelu z dashboardu → Upload → Klasyfikacja batch. Szybka klasyfikacja nowych tekstów zapisanym modelem.

## API (skrót)

**Klasteryzacja**

- **POST /api/cluster** — utworzenie zadania klasteryzacji (upload, parametry)
- **GET /api/cluster/job/{jobId}** — status i wynik zadania
- **POST /api/cluster/refine** — sugestie refinementu (merge/rename/reclassify) z LLM
- **POST /api/cluster/reclassify** — reklasyfikacja wybranych klastrów
- **POST /api/cluster/generate-labels** — generowanie etykiet LLM dla wybranych tematów
- **POST /api/cluster/export** — eksport wyników (JSON/CSV, z opcją włączenia insightów LLM)
- **GET /api/cluster/jobs** — lista zadań w backendzie

**Taksonomia**

- **POST /api/taxonomy** — utworzenie taksonomii
- **GET /api/taxonomy** — lista taksonomii
- **GET/DELETE /api/taxonomy/{id}** — odczyt / usunięcie taksonomii
- **POST/PATCH/DELETE /api/taxonomy/{id}/category** — CRUD kategorii (name, examples, description)
- **POST /api/taxonomy/{id}/import-clusters** — import klastrów z wyniku discovery jako kategorii
- **POST /api/taxonomy/{id}/import-template** — import szablonu kategorii

**Klasyfikacja (SetFit)**

- **POST /api/classify** — uruchomienie zadania treningu (taksonomia lub kategorie + opcjonalnie teksty)
- **GET /api/classify/job/{jobId}** — status treningu i wynik
- **POST /api/classify/predict**, **POST /api/classify/batch** — predykcja zapisanym modelem

**Modele**

- **GET /api/models** — lista zapisanych modeli SetFit
- **GET /api/models/{modelId}** — metadane modelu
- **DELETE /api/models/{modelId}** — usunięcie modelu

**Inne**

- **GET /api/health** — stan serwisu (encoder, Redis, LLM)

## Licencja

Zgodnie z repozytorium projektu.
