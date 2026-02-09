# Topic Discovery Hub -- Architektura Serwisu Backendowego

## Spis tresci

1. [Przeglad systemu](#1-przeglad-systemu)
2. [Architektura wysokopoziomowa](#2-architektura-wysokopoziomowa)
3. [Kontrakt danych (typy)](#3-kontrakt-danych)
4. [Endpointy API](#4-endpointy-api)
5. [Pipeline ML -- szczegoly](#5-pipeline-ml)
6. [Integracja z LLM](#6-integracja-z-llm)
7. [Konfiguracja i parametry](#7-konfiguracja-i-parametry)
8. [Obsluga bledow](#8-obsluga-bledow)
9. [Bezpieczenstwo i wdrozenie bankowe](#9-bezpieczenstwo)
10. [Przykladowe zapytania](#10-przyklady)

---

## 1. Przeglad systemu

Topic Discovery Hub to wewnetrzne narzedzie bankowe umozliwiajace pracownikom contact center
automatyczne wykrywanie kategorii tematycznych w dokumentach tekstowych (notatki z rozmow,
maile, reklamacje). System laczy SOTA model encoder z klasteryzacja i refinementem LLM.

### Glowne komponenty:

```
+------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |
|   Frontend       |---->|   API Gateway    |---->|   ML Pipeline    |
|   (Next.js)      |     |   (Next.js API)  |     |   (Python)       |
|                  |<----|                  |<----|                  |
+------------------+     +------------------+     +------------------+
                               |                        |
                               v                        v
                         +------------+          +------------+
                         |   LLM      |          |  Encoder   |
                         |   Service   |          |  Model     |
                         +------------+          +------------+
```

**Przeplywy danych:**
- Frontend -> API: teksty + konfiguracja
- API -> Encoder: teksty -> embeddingi (wektory)
- API -> UMAP: embeddingi -> wspolrzedne 2D
- API -> HDBSCAN: embeddingi -> przypisania klastrow
- API -> LLM: probki z klastrow -> etykiety + sugestie refinementu
- API -> Frontend: pelen wynik klasteryzacji

---

## 2. Architektura wysokopoziomowa

### Wariant A: Monolityczny (rozwoj / PoC)

Next.js API Routes pelnia role proxy do serwisu Pythonowego, ktory
uruchamia caly pipeline ML. Wszystko na jednym serwerze.

```
Next.js App
  |-- /app/api/cluster/route.ts           POST  Glowna klasteryzacja
  |-- /app/api/cluster/refine/route.ts    POST  Refinement z LLM
  |-- /app/api/cluster/rename/route.ts    PATCH Reczna zmiana nazwy topiku
  |-- /app/api/cluster/merge/route.ts     POST  Laczenie klastrow
  |-- /app/api/cluster/split/route.ts     POST  Dzielenie klastra
  |-- /app/api/cluster/reclassify/route.ts POST  Reklasyfikacja dokumentow
  |-- /app/api/cluster/export/route.ts    POST  Generowanie raportu
  |-- /app/api/health/route.ts            GET   Healthcheck
```

### Wariant B: Mikroserwisy (produkcja bankowa)

```
                    +-------------------+
                    |   API Gateway     |
                    |   (Next.js)       |
                    +-------------------+
                      |       |       |
            +---------+   +---+---+   +---------+
            |             |       |             |
  +---------v----+  +-----v---+  +v----------+  +v---------+
  | Encoder      |  | Cluster |  | LLM       |  | Export   |
  | Service      |  | Service |  | Service   |  | Service  |
  | (Python,     |  | (Python |  | (OpenAI/  |  | (Python) |
  |  FastAPI)    |  |  UMAP+  |  |  Azure/   |  |          |
  |              |  |  HDBSCAN|  |  local)   |  |          |
  +--------------+  +---------+  +-----------+  +----------+
```

---

## 3. Kontrakt danych

### Typy wejsciowe

```typescript
// Poziom granularnosci -- mapuje sie na parametry HDBSCAN
type Granularity = "low" | "medium" | "high"

// Parametry mapowania granularnosci -> HDBSCAN
interface GranularityConfig {
  low:    { min_cluster_size: 50, min_samples: 15, cluster_selection_epsilon: 0.5 }
  medium: { min_cluster_size: 20, min_samples: 8,  cluster_selection_epsilon: 0.3 }
  high:   { min_cluster_size: 8,  min_samples: 3,  cluster_selection_epsilon: 0.1 }
}
```

### Typy wynikowe

```typescript
// Pojedynczy dokument z przypisaniem do klastra i pozycja 2D
interface DocumentItem {
  id: string           // unikalny identyfikator dokumentu
  text: string         // oryginalny tekst
  clusterId: number    // id przypisanego klastra (-1 = szum/outlier)
  x: number            // wspolrzedna X po UMAP (do wizualizacji)
  y: number            // wspolrzedna Y po UMAP (do wizualizacji)
}

// Wykryty temat/klaster
interface ClusterTopic {
  id: number                // unikalny id klastra
  label: string             // etykieta wygenerowana przez LLM (po polsku)
  description: string       // opis klastra wygenerowany przez LLM
  documentCount: number     // liczba dokumentow w klastrze
  sampleTexts: string[]     // 3-5 reprezentatywnych tekstow (najblizsze centroidowi)
  color: string             // kolor do wizualizacji (hsl)
  centroidX: number         // centroid X (srednia wspolrzednych 2D dokumentow)
  centroidY: number         // centroid Y
  coherenceScore: number    // 0-1, miara spojnosci klastra (silhouette score)
  keywords: string[]        // 3-7 slow kluczowych wyekstrahowanych przez LLM/TF-IDF
}

// Sugestia LLM dotyczaca refinementu
interface LLMSuggestion {
  type: "merge" | "split" | "rename" | "reclassify"
  description: string       // opis sugestii po polsku
  targetClusterIds: number[] // id klastrow, ktorych dotyczy
  suggestedLabel?: string   // nowa proponowana nazwa (dla merge/rename)
  confidence: number        // 0-1, pewnosc LLM
  applied: boolean          // czy sugestia zostala zastosowana
}

// Pelny wynik klasteryzacji
interface ClusteringResult {
  documents: DocumentItem[]
  topics: ClusterTopic[]
  llmSuggestions: LLMSuggestion[]
  totalDocuments: number
  noise: number              // liczba dokumentow nieskategoryzowanych
}
```

---

## 4. Endpointy API

### 4.1 `POST /api/cluster` -- Glowna klasteryzacja

Uruchamia pelen pipeline: encoder -> UMAP -> HDBSCAN -> LLM labeling.

**Request:**
```json
{
  "texts": ["tekst1", "tekst2", "..."],
  "granularity": "medium",
  "iteration": 0
}
```

| Pole          | Typ        | Wymagane | Opis |
|---------------|-----------|----------|------|
| `texts`       | string[]  | tak      | Tablica tekstow do analizy (min 10, max 50000) |
| `granularity` | string    | tak      | "low" / "medium" / "high" |
| `iteration`   | number    | nie      | Nr iteracji (0 = pierwsza). Sluzy do zroznicowania seedow losowych |

**Response (200):**
```json
{
  "documents": [...],
  "topics": [...],
  "llmSuggestions": [...],
  "totalDocuments": 1200,
  "noise": 24,
  "meta": {
    "pipelineDurationMs": 4520,
    "encoderModel": "your-sota-encoder-v2",
    "umapParams": { "n_neighbors": 15, "min_dist": 0.1, "n_components": 2 },
    "hdbscanParams": { "min_cluster_size": 20, "min_samples": 8 },
    "llmModel": "gpt-4o"
  }
}
```

**Bledy:**
- `400` -- brak tekstow, bledna granularnosc, za malo tekstow (< 10)
- `413` -- za duzo tekstow (> 50000)
- `500` -- blad pipeline'u
- `503` -- encoder niedostepny

---

### 4.2 `POST /api/cluster/refine` -- Refinement LLM

Uruchamia kolejna runde analizy LLM na istniejacych klastrach. LLM czyta probki,
ocenia koherencje i generuje nowe sugestie. **Nie zmienia klastrow** -- zwraca tylko sugestie.

**Request:**
```json
{
  "topics": [...],
  "documents": [...],
  "previousSuggestions": [...],
  "focusAreas": ["coherence", "granularity", "naming"]
}
```

| Pole                   | Typ            | Wymagane | Opis |
|------------------------|---------------|----------|------|
| `topics`               | ClusterTopic[] | tak     | Aktualne topiki |
| `documents`            | DocumentItem[] | tak     | Dokumenty z przypisaniami |
| `previousSuggestions`  | LLMSuggestion[] | nie   | Juz przetworzone sugestie (zeby LLM ich nie powtorzyl) |
| `focusAreas`           | string[]       | nie     | Na czym skupic analiye: "coherence", "granularity", "naming", "outliers" |

**Response (200):**
```json
{
  "suggestions": [
    {
      "type": "merge",
      "description": "Klastry 'Reklamacja karty' i 'Problemy z platnoscia' ...",
      "targetClusterIds": [0, 5],
      "suggestedLabel": "Reklamacje finansowe",
      "confidence": 0.82,
      "applied": false
    }
  ],
  "analysis": {
    "overallCoherence": 0.74,
    "problematicClusters": [3, 7],
    "suggestedOptimalK": 6
  }
}
```

---

### 4.3 `PATCH /api/cluster/rename` -- Zmiana nazwy topiku

Reczna zmiana nazwy topiku przez uzytkownika.

**Request:**
```json
{
  "topicId": 3,
  "newLabel": "Problemy z logowaniem do systemu"
}
```

**Response (200):**
```json
{
  "topicId": 3,
  "oldLabel": "Bankowosc internetowa",
  "newLabel": "Problemy z logowaniem do systemu",
  "updated": true
}
```

---

### 4.4 `POST /api/cluster/merge` -- Laczenie klastrow

Laczy 2+ klastrow w jeden. Przelicza centroid, koherencje, dokumenty.

**Request:**
```json
{
  "clusterIds": [0, 5],
  "newLabel": "Reklamacje finansowe",
  "documents": [...],
  "topics": [...]
}
```

**Response (200):** Zwraca zaktualizowany `ClusteringResult` z polaczonymi klastrami.

**Logika backendu:**
1. Wszystkie dokumenty z `clusterIds` dostaja nowy wspolny `clusterId`
2. Centroid = srednia wspolrzednych
3. Koherencja = przeliczona (silhouette) lub szacunkowa
4. Slowa kluczowe = unia + LLM re-ranking
5. Opis = LLM generuje nowy opis dla polaczonego klastra

---

### 4.5 `POST /api/cluster/split` -- Dzielenie klastra

Dzieli klaster na 2+ podklastry. Uruchamia mini-HDBSCAN na podzbiorze.

**Request:**
```json
{
  "clusterId": 1,
  "numSubclusters": 2,
  "documents": [...],
  "topics": [...]
}
```

**Response (200):** Zaktualizowany `ClusteringResult` z podzielonymi klastrami.

**Logika backendu:**
1. Wyciagnij dokumenty z danego klastra
2. Uruchom HDBSCAN z mniejszym `min_cluster_size` na podzbiorze
3. LLM generuje etykiety dla nowych podklastrow
4. Przypisz nowe `clusterId` do dokumentow

---

### 4.6 `POST /api/cluster/reclassify` -- Reklasyfikacja dokumentow

Przenosi dokumenty miedzy klastrami na podstawie sugestii LLM lub recznego wyboru.

**Request:**
```json
{
  "documentIds": ["doc-14", "doc-28", "doc-45"],
  "fromClusterId": 3,
  "toClusterId": 4,
  "documents": [...],
  "topics": [...]
}
```

**Response (200):** Zaktualizowany `ClusteringResult`.

---

### 4.7 `POST /api/cluster/export` -- Generowanie raportu

Generuje sformatowany raport na podstawie wynikow klasteryzacji.

**Request:**
```json
{
  "result": { ... },
  "format": "text",
  "language": "pl",
  "includeExamples": true,
  "includeLLMInsights": true
}
```

| Pole               | Typ     | Opis |
|--------------------|---------|------|
| `format`           | string  | "text" / "csv" / "json" / "pdf" |
| `language`         | string  | "pl" / "en" |
| `includeExamples`  | boolean | Dolacz przyklady z kazdego klastra |
| `includeLLMInsights` | boolean | Dolacz analize i rekomendacje LLM |

**Response (200):** Blob pliku (text/csv/json) lub JSON z trescia raportu.

---

### 4.8 `GET /api/health` -- Healthcheck

Sprawdza dostepnosc wszystkich komponentow pipeline'u.

**Response (200):**
```json
{
  "status": "healthy",
  "components": {
    "encoder": { "status": "up", "model": "your-sota-encoder-v2", "latencyMs": 45 },
    "umap": { "status": "up", "version": "0.5.5" },
    "hdbscan": { "status": "up", "version": "0.8.33" },
    "llm": { "status": "up", "model": "gpt-4o", "latencyMs": 320 }
  },
  "timestamp": "2026-02-09T12:00:00Z"
}
```

---

## 5. Pipeline ML -- szczegoly

### 5.1 Krok 1: Enkodowanie (Encoder)

```python
# Pseudokod -- dostosuj do swojego modelu
from your_encoder import SotaEncoder

encoder = SotaEncoder.load("model-checkpoint")
embeddings = encoder.encode(texts, batch_size=64, show_progress=True)
# embeddings: np.ndarray, shape (N, D), np. (1200, 768)
```

**Parametry:**
- `batch_size`: 32-128, w zaleznosci od GPU/RAM
- `normalize`: True (L2 normalizacja)
- `max_seq_length`: 512 (tokeny)

### 5.2 Krok 2: Redukcja wymiarow (UMAP)

```python
import umap

reducer = umap.UMAP(
    n_neighbors=15,          # wiecej = bardziej globalna struktura
    min_dist=0.1,            # mniej = gestsze klastry
    n_components=2,          # 2D do wizualizacji
    metric='cosine',         # dopasowane do embeddingów
    random_state=42 + iteration
)
coords_2d = reducer.fit_transform(embeddings)
```

**Dlaczego UMAP a nie t-SNE:**
- Lepsze zachowanie globalnej struktury (klastry daleko od siebie)
- Szybszy (~10x)
- Deterministyczny z `random_state`

### 5.3 Krok 3: Klasteryzacja (HDBSCAN)

```python
import hdbscan

# Parametry zaleznie od granularnosci
GRANULARITY_CONFIG = {
    "low":    {"min_cluster_size": 50, "min_samples": 15, "cluster_selection_epsilon": 0.5},
    "medium": {"min_cluster_size": 20, "min_samples": 8,  "cluster_selection_epsilon": 0.3},
    "high":   {"min_cluster_size": 8,  "min_samples": 3,  "cluster_selection_epsilon": 0.1},
}

params = GRANULARITY_CONFIG[granularity]
clusterer = hdbscan.HDBSCAN(**params, metric='euclidean', prediction_data=True)
labels = clusterer.fit_predict(embeddings)  # lub coords_2d -- do testow
probabilities = clusterer.probabilities_

# labels[i] == -1 oznacza szum (outlier)
noise_count = (labels == -1).sum()
```

**Klasteryzacja na embeddingach vs. UMAP-coords:**
- Na embeddingach: lepsze wyniki (pelna informacja), wolniejsze
- Na coords_2d: szybsze, mapa = klastry (konsystentne wizualnie)
- Rekomendacja: klasteryzuj na embeddingach, wizualizuj na UMAP

### 5.4 Krok 4: Koherencja (Silhouette)

```python
from sklearn.metrics import silhouette_samples

# Tylko dla dokumentow nie-szum
mask = labels != -1
if mask.sum() > 1:
    scores = silhouette_samples(embeddings[mask], labels[mask], metric='cosine')
    # Srednia per klaster
    for cluster_id in set(labels[mask]):
        cluster_mask = labels[mask] == cluster_id
        coherence = scores[cluster_mask].mean()  # 0-1 (realistycznie -1 do 1)
```

### 5.5 Krok 5: Probki reprezentatywne

```python
import numpy as np

def get_representative_samples(embeddings, labels, texts, cluster_id, n=5):
    """Zwraca n tekstow najblizszych centroidowi klastra."""
    mask = labels == cluster_id
    cluster_embeddings = embeddings[mask]
    cluster_texts = [t for t, m in zip(texts, mask) if m]

    centroid = cluster_embeddings.mean(axis=0)
    distances = np.linalg.norm(cluster_embeddings - centroid, axis=1)
    top_indices = distances.argsort()[:n]

    return [cluster_texts[i] for i in top_indices]
```

### 5.6 Krok 6: Slowa kluczowe (TF-IDF / c-TF-IDF)

```python
from sklearn.feature_extraction.text import TfidfVectorizer

def extract_keywords(texts_in_cluster, all_texts, n=7):
    """c-TF-IDF: TF-IDF ale klaster jako jeden dokument."""
    cluster_doc = " ".join(texts_in_cluster)
    all_docs = [cluster_doc] + [" ".join(all_texts)]  # uproszczony

    vectorizer = TfidfVectorizer(max_features=1000, stop_words=POLISH_STOP_WORDS)
    tfidf = vectorizer.fit_transform([cluster_doc])
    feature_names = vectorizer.get_feature_names_out()

    scores = tfidf.toarray()[0]
    top_indices = scores.argsort()[-n:][::-1]
    return [feature_names[i] for i in top_indices]
```

---

## 6. Integracja z LLM

### 6.1 Labelowanie klastrow

LLM otrzymuje probki z kazdego klastra i generuje etykiete + opis.

**Prompt (system):**
```
Jestes ekspertem od analizy tekstu w polskim sektorze bankowym.
Analizujesz grupy tekstow (klastry) z contact center bankowego.
Dla kazdej grupy musisz:
1. Nadac krotka, opisowa nazwe kategorii (max 5 slow, po polsku)
2. Napisac 1-zdaniowy opis kategorii
3. Nie uzywac zbyt ogolnych nazw jak "Rozne" czy "Inne"
```

**Prompt (user):**
```
Klaster {id} ({doc_count} dokumentow, koherencja: {coherence}%):

Reprezentatywne teksty:
1. "{sample_1}"
2. "{sample_2}"
3. "{sample_3}"
4. "{sample_4}"
5. "{sample_5}"

Slowa kluczowe TF-IDF: {keywords}

Podaj etykiete i opis w formacie JSON:
{"label": "...", "description": "..."}
```

### 6.2 Generowanie sugestii refinementu

Po klasteryzacji, LLM dostaje przeglad WSZYSTKICH klastrow i szuka:

**Prompt (system):**
```
Jestes ekspertem od optymalizacji kategoryzacji tekstu.
Przegladasz wynik klasteryzacji dokumentow z contact center bankowego.
Twoim zadaniem jest zaproponowanie ulepszen, takich jak:

1. MERGE (polaczenie) -- jezeli dwa klastry sa bardzo podobne tematycznie
2. SPLIT (podzial) -- jezeli klaster ma wyraznie dwie podgrupy
3. RENAME (zmiana nazwy) -- jezeli nazwa jest niejasna lub nieadekwatna
4. RECLASSIFY (reklasyfikacja) -- jezeli czesc dokumentow lepiej pasuje do innego klastra

Kazdej sugestii przypisz confidence (0-1). Podaj max 5 sugestii.
Odpowiedz w formacie JSON array.
```

**Prompt (user):**
```
Wynik klasteryzacji ({total_docs} dokumentow, {num_clusters} klastrow):

{for each cluster:}
Klaster {id}: "{label}" ({doc_count} dok., koherencja: {coherence}%)
  Opis: {description}
  Slowa kluczowe: {keywords}
  Przykladowe teksty:
  - "{sample_1}"
  - "{sample_2}"
  - "{sample_3}"

{end for}

Dokumenty nieskategoryzowane (szum): {noise_count}

Zaproponuj ulepszenia. Odpowiedz jako JSON:
[
  {
    "type": "merge|split|rename|reclassify",
    "description": "opis sugestii po polsku",
    "targetClusterIds": [id1, id2],
    "suggestedLabel": "opcjonalnie nowa nazwa",
    "confidence": 0.82
  }
]
```

### 6.3 Wazne uwagi LLM

- **Model:** Rekomendacja GPT-4o lub Claude 3.5 Sonnet (lepsze rozumienie polskiego)
- **Temperature:** 0.3 (niska -- chcemy determinizm)
- **Max tokens:** 2000 per request
- **Retry:** 3x z exponential backoff
- **Fallback:** Jezeli LLM nie odpowie, uzyj nazw opartych na TF-IDF keywords
- **Koszt:** ~$0.01-0.05 per klasteryzacja (przy 5-12 klastrach)
- **Latency:** 2-8s (rownolegle requesty per klaster)

---

## 7. Konfiguracja i parametry

### Zmienne srodowiskowe

```env
# Encoder
ENCODER_API_URL=http://localhost:8000/encode
ENCODER_MODEL_NAME=your-sota-encoder-v2
ENCODER_BATCH_SIZE=64
ENCODER_MAX_SEQ_LENGTH=512

# LLM
LLM_PROVIDER=openai                    # openai / azure / anthropic / local
LLM_MODEL=gpt-4o
LLM_API_KEY=sk-...
LLM_API_BASE_URL=https://api.openai.com/v1
LLM_TEMPERATURE=0.3
LLM_MAX_TOKENS=2000

# Pipeline
UMAP_N_NEIGHBORS=15
UMAP_MIN_DIST=0.1
UMAP_METRIC=cosine
CLUSTERING_METRIC=euclidean

# Limity
MAX_TEXTS=50000
MIN_TEXTS=10
MAX_TEXT_LENGTH=5000

# Bezpieczenstwo
API_KEY=internal-bank-api-key-xxx
CORS_ORIGINS=https://internal.bank.pl
```

### Mapowanie Granularity -> HDBSCAN (konfigurowalny)

| Granularity | min_cluster_size | min_samples | cluster_selection_epsilon | Oczekiwane klastry |
|-------------|-----------------|-------------|--------------------------|-------------------|
| low         | 50              | 15          | 0.5                      | 3-5               |
| medium      | 20              | 8           | 0.3                      | 5-8               |
| high        | 8               | 3           | 0.1                      | 8-15              |

---

## 8. Obsluga bledow

### Kody bledow

| Kod | Nazwa                    | Opis |
|-----|--------------------------|------|
| 400 | INVALID_INPUT            | Brak tekstow, bledne parametry |
| 400 | TOO_FEW_TEXTS            | Mniej niz 10 tekstow |
| 413 | TOO_MANY_TEXTS           | Wiecej niz 50000 tekstow |
| 422 | CLUSTERING_FAILED        | HDBSCAN nie znalazl klastrow (za duzo szumu) |
| 500 | PIPELINE_ERROR           | Blad wewnetrzny pipeline'u |
| 503 | ENCODER_UNAVAILABLE      | Serwis encodera niedostepny |
| 503 | LLM_UNAVAILABLE          | Serwis LLM niedostepny |
| 504 | PIPELINE_TIMEOUT         | Przekroczony timeout (domyslnie 120s) |

### Format odpowiedzi bledu

```json
{
  "error": {
    "code": "TOO_FEW_TEXTS",
    "message": "Wymagane minimum 10 tekstow do analizy. Otrzymano: 3.",
    "details": {
      "received": 3,
      "minimum": 10
    }
  }
}
```

### Fallback strategy

1. **Encoder timeout:** Retry 2x, potem blad 503
2. **HDBSCAN 0 klastrow:** Automatycznie zmniejsz `min_cluster_size` o 50%, retry
3. **LLM timeout:** Retry 3x, potem fallback na nazwy z TF-IDF keywords
4. **LLM invalid JSON:** Retry z prostsza instrukcja, potem fallback

---

## 9. Bezpieczenstwo i wdrozenie bankowe

### Wymagania bankowe

- **Self-hosted:** Caly system on-premise lub w prywatnym cloudzie banku
- **Szyfrowanie:** TLS 1.3 w tranzycie, AES-256 at rest
- **Brak retencji danych:** Teksty NIE sa przechowywane -- przetwarzanie in-memory
- **Audit log:** Kazde wywolanie API logowane (kto, kiedy, ile tekstow, bez tresci)
- **RBAC:** Dostep tylko dla autoryzowanych pracownikow (integracja z AD/LDAP)
- **Rate limiting:** Max 10 requestow/min na uzytkownika
- **PII detection:** Opcjonalny krok pre-procesowania usuwajacy dane osobowe z tekstow

### Uwagi dot. LLM

- Jezeli bank nie pozwala na wysylanie danych do zewnetrznego LLM:
  - Uzyj **lokalnego LLM** (np. Llama 3, Mistral) via Ollama/vLLM
  - Lub uzyj **Azure OpenAI** z instancja w regionie EU i DPA
  - Lub w ogole pominac LLM: nazwy z TF-IDF + klasteryzacja hierarchiczna

---

## 10. Przyklady

### Przyklad 1: Pelna klasteryzacja

```bash
curl -X POST http://localhost:3000/api/cluster \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer internal-bank-api-key-xxx" \
  -d '{
    "texts": [
      "Nie moge sie zalogowac do aplikacji mobilnej",
      "Chcialbym uzyskac informacje o kredycie hipotecznym",
      "Karta zostala zablokowana po 3 blednych probach PIN",
      "..."
    ],
    "granularity": "medium",
    "iteration": 0
  }'
```

### Przyklad 2: Refinement LLM

```bash
curl -X POST http://localhost:3000/api/cluster/refine \
  -H "Content-Type: application/json" \
  -d '{
    "topics": [...],
    "documents": [...],
    "focusAreas": ["coherence", "naming"]
  }'
```

### Przyklad 3: Laczenie klastrow

```bash
curl -X POST http://localhost:3000/api/cluster/merge \
  -H "Content-Type: application/json" \
  -d '{
    "clusterIds": [0, 5],
    "newLabel": "Reklamacje finansowe",
    "documents": [...],
    "topics": [...]
  }'
```

### Przyklad 4: Zmiana nazwy

```bash
curl -X PATCH http://localhost:3000/api/cluster/rename \
  -H "Content-Type: application/json" \
  -d '{
    "topicId": 3,
    "newLabel": "Awarie aplikacji bankowej"
  }'
```

---

## Diagram sekwencji -- pelny flow

```
Uzytkownik    Frontend      API Gateway    Encoder    UMAP/HDBSCAN    LLM
    |             |              |            |            |            |
    |--upload---->|              |            |            |            |
    |--configure->|              |            |            |            |
    |--"Analizuj"|              |            |            |            |
    |             |--POST /cluster----------->|            |            |
    |             |              |--encode--->|            |            |
    |             |              |<-embeddings|            |            |
    |             |              |--reduce+cluster-------->|            |
    |             |              |<-labels+coords----------|            |
    |             |              |--label clusters-------------------->|
    |             |              |<-labels+suggestions--------------<--|
    |             |<--ClusteringResult--------|            |            |
    |<--wyswietl--|              |            |            |            |
    |             |              |            |            |            |
    |--"Zastosuj  |              |            |            |            |
    |   sugestie" |              |            |            |            |
    |             |--POST /merge>|            |            |            |
    |             |<-updated-----|            |            |            |
    |<--odswieĩ---|              |            |            |            |
    |             |              |            |            |            |
    |--"Ponow     |              |            |            |            |
    |   klasteryz"|              |            |            |            |
    |             |--POST /cluster (iteration=1)---------->|            |
    |             |              |   ... (caly pipeline od nowa) ...    |
```

---

## Struktura plikow

### Next.js API (proxy/mock)

```
app/api/
  health/route.ts              GET  -- healthcheck
  cluster/
    route.ts                   POST -- glowna klasteryzacja
    refine/route.ts            POST -- LLM refinement
    rename/route.ts            PATCH -- zmiana nazwy
    merge/route.ts             POST -- laczenie klastrow
    split/route.ts             POST -- dzielenie klastra
    reclassify/route.ts        POST -- reklasyfikacja dokumentow
    export/route.ts            POST -- generowanie raportu
lib/
  clustering-types.ts          -- typy danych (zrodlo prawdy)
  mock-clustering.ts           -- mockowe generowanie wynikow
  api-client.ts                -- klient API dla frontendu
  backend-proxy.ts             -- proxy do Python backend
```

### Python Backend (FastAPI)

```
backend/
  main.py                      -- FastAPI app, lifespan, CORS
  config.py                    -- konfiguracja (env vars, HDBSCAN params)
  schemas.py                   -- Pydantic modele (zsynchronizowane z TS types)
  requirements.txt             -- Python dependencies
  Dockerfile                   -- konteneryzacja
  run.sh                       -- skrypt startowy z venv
  .env.example                 -- szablon zmiennych srodowiskowych
  services/
    __init__.py
    encoder.py                 -- ModernBERT-base: tokenizacja + mean pooling
    clustering.py              -- UMAP + HDBSCAN + Silhouette + c-TF-IDF
    llm.py                     -- OpenAI: labeling + refinement (async, retry, fallback)
    pipeline.py                -- orkiestrator: encoder -> cluster -> llm
  routers/
    __init__.py
    cluster.py                 -- POST /cluster, /refine, /merge, /split, /reclassify, PATCH /rename
    export.py                  -- POST /cluster/export (CSV BOM, JSON, text)
    health.py                  -- GET /health (status kazdego komponentu)
```

---

## Uruchamianie

### Tryb 1: Tylko frontend (mock / demo)

```bash
npm run dev
# Frontend: http://localhost:3000
# Wszystkie endpointy zwracaja mockowe dane
```

### Tryb 2: Frontend + Python backend (produkcja)

```bash
# Terminal 1 -- backend
cd backend
chmod +x run.sh
./run.sh
# API: http://localhost:8000, Docs: http://localhost:8000/docs

# Terminal 2 -- frontend
PYTHON_BACKEND_URL=http://localhost:8000 npm run dev
# Frontend: http://localhost:3000 -- proxy do backendu
```

### Tryb 3: Docker Compose

```bash
# Ustaw OPENAI_API_KEY w .env lub eksportuj
export OPENAI_API_KEY=sk-...
docker compose up --build
# Frontend: http://localhost:3000, Backend: http://localhost:8000
```

---

## Przelaczanie trybow

Zmienna `PYTHON_BACKEND_URL` steruje trybem:

| Zmienna                | Tryb        | Opis                                           |
|------------------------|-------------|-------------------------------------------------|
| (nie ustawiona)        | MOCK        | Next.js API Routes zwracaja symulowane dane     |
| `http://localhost:8000`| PRODUCTION  | Next.js proxyuje requesty do Python FastAPI     |

Kazdy Next.js API route sprawdza `isPythonBackendEnabled()` i albo proxyuje
caly request do backendu Python, albo wykonuje lokalna logike mockowa.
Frontend (`lib/api-client.ts`) zawsze komunikuje sie z Next.js -- nie wie
o istnieniu backendu Python.
