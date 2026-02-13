# Topic Discovery Hub

Aplikacja do automatycznego odkrywania tematów w dokumentach tekstowych (np. z contact center bankowego): embeddingi, redukcja wymiarów, klasteryzacja HDBSCAN, etykiety i sugestie generowane przez LLM.

## Wymagania

- **Node.js** (frontend Next.js)
- **Python 3.10+** (backend FastAPI)
- **Redis** (kolejka zadań, cache embeddingów)

## Struktura projektu

- `app/` — frontend Next.js (React)
- `backend/` — API FastAPI, encoder (ModernBERT), pipeline klasteryzacji, integracja LLM
- `components/` — komponenty UI (wizard, dashboard zadań)

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

## API (skrót)

- **POST /api/cluster/job** — utworzenie zadania klasteryzacji (upload pliku CSV/JSON, parametry)
- **GET /api/cluster/job/{jobId}** — status i wynik zadania
- **POST /api/cluster/refine** — sugestie refinementu (merge/rename/reclassify) z LLM
- **POST /api/cluster/reclassify** — reklasyfikacja wybranych klastrów
- **POST /api/cluster/generate-labels** — generowanie etykiet LLM dla wybranych tematów
- **POST /api/export** — eksport wyników (JSON/CSV, z opcją włączenia insightów LLM)
- **GET /api/health** — stan serwisu (encoder, Redis, LLM)

## Licencja

Zgodnie z repozytorium projektu.
