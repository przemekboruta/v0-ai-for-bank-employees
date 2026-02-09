#!/bin/bash
# Topic Discovery Hub - Backend Startup Script
#
# Uzycie:
#   cd backend
#   chmod +x run.sh
#   ./run.sh
#
# Lub recznie:
#   pip install -r requirements.txt
#   uvicorn main:app --reload --port 8000

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================"
echo " Topic Discovery Hub - Backend"
echo "================================================"

# Sprawdz Python
if ! command -v python3 &> /dev/null; then
    echo "BLAD: Python 3 nie jest zainstalowany."
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1)
echo "Python: $PYTHON_VERSION"

# Sprawdz .env
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo ""
        echo "UWAGA: Plik .env nie istnieje. Kopiuje z .env.example..."
        cp .env.example .env
        echo "Uzupelnij .env o OPENAI_API_KEY przed uzyciem LLM."
        echo ""
    fi
fi

# Sprawdz venv
if [ ! -d "venv" ]; then
    echo ""
    echo "Tworzenie srodowiska wirtualnego..."
    python3 -m venv venv
fi

echo "Aktywacja srodowiska wirtualnego..."
source venv/bin/activate

# Instalacja/update zaleznosci
echo "Instalacja zaleznosci..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo ""
echo "Uruchamianie serwera..."
echo "  API:     http://localhost:8000"
echo "  Docs:    http://localhost:8000/docs"
echo "  Health:  http://localhost:8000/api/health"
echo "================================================"
echo ""

uvicorn main:app --reload --host 0.0.0.0 --port 8000
