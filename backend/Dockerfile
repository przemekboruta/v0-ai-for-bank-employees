# Topic Discovery Hub - Python Backend
# Multi-stage build dla mniejszego obrazu produkcyjnego

# === Stage 1: Build ===
FROM python:3.12-slim AS builder

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# === Stage 2: Runtime ===
FROM python:3.12-slim AS runtime

WORKDIR /app

# Kopiuj zainstalowane paczki
COPY --from=builder /install /usr/local

# Kopiuj kod aplikacji
COPY . .

# Zmienne srodowiskowe
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV HOST=0.0.0.0
ENV PORT=8000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

EXPOSE 8000

# Pre-download modelu przy buildzie (opcjonalnie, dla szybszego startu)
# RUN python -c "from transformers import AutoTokenizer, AutoModel; AutoTokenizer.from_pretrained('answerdotai/ModernBERT-base'); AutoModel.from_pretrained('answerdotai/ModernBERT-base')"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
