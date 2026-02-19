# TODO — Topic Discovery Hub

## Cele strategiczne

1. **Dla pracownika banku** — narzedzie, ktore w prosty sposob pomaga zrozumiec jakie tematy kryja sie w korespondencji, a nastepnie zbudowac i utrzymywac klasyfikator dopasowany do realiow danego zespolu. Bez wymaganej wiedzy ML.
2. **Dla tworcow modelu encoder** — showcase wartosci domain-adapted encodera (CPT + fine-tuning). Pokazanie, ze inwestycja w wlasny model przynosi wymierne korzysci: lepszy clustering, lepszy few-shot, semantic search — wszystko out-of-the-box.

## Wizja uzytkowa (user story)

> Wchodze na aplikacje. Moge od razu wrzucic plik z reklamacjami. Albo wybieram gotowy szablon kategorii i od razu trenuje klasyfikator (few-shot, potrzebuje tylko kilka przykladow na kategorie). Albo zaczynam od odkrywania — system sam znajdzie grupy tematyczne, ja wybieram te ktore maja sens i promuje je do kategorii. Potem trenuje model, klasyfikuje dane, ogladam wyniki. Jesli cos jest zle sklasyfikowane — poprawiam, dotrenowuje. Z czasem moj model sie poprawia. Moge go uzyc na nowych danych bez ponownego treningu.

---

## Faza 0 — Naprawienie istniejacych bledow i luk

**Priorytet: KRYTYCZNY — bez tego reszta nie ma sensu**

- [ ] **Nawigacja Explore → Categories** — brak przycisku "Dalej" na kroku Explore w sciezce full; `canGoNext` nie obsluguje `"explore"`; step indicator nie zawiera `"explore"` w `FULL_STEPS`
- [ ] **Karta Batch na dashboardzie** — `onClick={() => {}}` (nic nie robi); albo podpiac do ModelManager, albo usunac karte
- [ ] **Zapis modelu z wynikow klasyfikacji** — `onSaveModel` nigdy nie jest przekazywany do `StepClassificationResults`; przycisk sie nie renderuje
- [ ] **Zaawansowana reklasyfikacja** — dropdowny Algorithm i Dim Reduction w StepReview nie maja `onChange` handlers; wartosci sa ignorowane
- [ ] **Cicha awaria tworzenia taksonomii** — `handleGoToCategories` lapie blad bez feedbacku; przyciski szablonow znikaja gdy backend niedostepny
- [ ] **Accuracy treningowe vs walidacyjne** — `setfit_service.py` ewaluuje na danych treningowych (in-sample); wyswietlane 95-100% accuracy jest mylace
- [ ] **Edycje kategorii nie sa persystowane** — StepCategories trzyma kategorie tylko w React state, nie synchronizuje z Redis/taxonomy API
- [ ] **Fallback confidence=1.0** — gdy `predict_proba` zawiedzie, wszystkie dokumenty dostaja 100% confidence bez ostrzezenia

---

## Faza 1 — UX dla przecietnego pracownika (guided experience)

**Cel: uzytkownik bez wiedzy ML przechodzi caly flow bez frustracji**

### 1.1 Onboarding i dashboard
- [x] **Welcome screen** — "Co chcesz dzisiaj zrobic?" z 3 sciezkami i opisami po ludzku
  - "Odkryj tematy" — nie wiem jakie kategorie sa w moich danych
  - "Klasyfikuj z szablonu" — mam gotowe kategorie, chce tylko przypisac dokumenty
  - "Uzyj istniejacego modelu" — mam juz wytrenowany model, chce go uzyc na nowych danych
- [x] **Info-boxy (StepHelpBox)** na kazdym kroku wizarda — kontekstowe wyjasnienia po polsku co sie dzieje i dlaczego (upload, configure, review, categories, training, classification-results)
- [ ] Dashboard pokazuje ostatnie sesje z wynikami (ile dokumentow, ile kategorii, accuracy) — czesciowo jest via JobDashboard

### 1.2 Uproszczony krok konfiguracji
- [x] **Tryb prosty** (domyslny): karty granulacji (low/medium/high) z ludzkimi opisami — juz byl, ulepszone opisy
- [x] **Tryb zaawansowany** (expandable): UMAP dims, HDBSCAN params, encoder model — juz byl
- [x] Domyslne ustawienia optymalne dla typowego zbioru (ustawione w backendzie)

### 1.3 Krok przegladania wynikow (Review) — uproszczenie
- [x] **Widok "szybki przeglad"** — podsumowanie: ile klastrow, ile w szumie, top-5 klastrow, liczba sugestii AI
- [x] Jasne CTA: "Tematy wygladaja dobrze? Wybierz te ktore chcesz zachowac jako kategorie" (przycisk Promuj)
- [x] Ukrycie zaawansowanych opcji (merge, reclassify, rename) pod "Narzedzia zaawansowane" (collapsed)
- [ ] **Obsluga szumu (noise)** — mozliwosc recznego przypisania niesklasyfikowanych dokumentow

### 1.4 Krok kategorii — lepsze prowadzenie
- [x] Wskazowki: "Dodaj min. 8-10 przykladow na kategorie" (progress badge X/8 per kategoria)
- [ ] **Podpowiedzi przykladow z danych** — po clusteringu system proponuje przyklady z dokumentow w danym klastrze
- [ ] Walidacja: ostrzezenie gdy kategorie sa zbyt podobne (cosine similarity nazw/przykladow)
- [x] Mozliwosc importu przykladow — wklejanie wielu linii z Excela/CSV (juz bylo, ulepszone placeholder z przykladem)

---

## Faza 2 — Active Learning (killer feature)

**Cel: iteracyjne ulepszanie modelu z minimalnym wysilkiem uzytkownika**

### 2.1 Petla informacji zwrotnej (feedback loop)
- [ ] **Review nisko-pewnych predykcji** — po klasyfikacji, pokaz uzytkownikowi dokumenty z confidence < prog (np. 0.6) i poprosc o prawidlowa etykiete
- [ ] Uzytkownik moze tez poprawic zle sklasyfikowane dokumenty z wysokim confidence
- [ ] Poprawione dokumenty trafiaja jako nowe przyklady do kategorii
- [ ] **Przycisk "Dotrenuj model"** — retrain SetFit z powiekszonymi przykladami (bez koniecznosci przechodzenia calego flow od poczatku)

### 2.2 Smart sampling
- [ ] System wybiera dokumenty do review nie tylko po confidence, ale tez po diversity (roznorodnosc w przestrzeni embeddingowej)
- [ ] Priorytetyzacja: dokumenty blisko granicy decyzyjnej miedzy kategoriami

### 2.3 Tracking postepow
- [ ] Historia wersji modelu — kazdy retrain to nowa wersja, mozna porownac accuracy/metryki
- [ ] Wykres: jak accuracy rosnie z kazda iteracja active learningu
- [ ] Metryki per-kategoria: precision, recall, F1 (na zbiorze walidacyjnym, nie treningowym!)

---

## Faza 3 — Showcase wartosci encodera

**Cel: pokazac w organizacji, ze domain-adapted encoder >> generic model**

### 3.1 Semantic search
- [ ] **Wyszukiwarka semantyczna** — uzytkownik wpisuje opis problemu, system zwraca najbardziej podobne dokumenty z bazy
- [ ] Wykorzystuje embeddingi z encodera (juz sa obliczone podczas clusteringu/klasyfikacji)
- [ ] Pokaz side-by-side: wyniki z naszego encodera vs generic (np. multilingual-e5) — optional demo mode

### 3.2 Detekcja near-duplicates
- [ ] Po uploadzie — automatyczne wykrycie blizniaczo podobnych dokumentow (cosine sim > 0.95)
- [ ] Uzytkownik decyduje: polaczyc, usunac duplikaty, zostawic
- [ ] Przydatne w realiach bankowych — te same reklamacje przesylane wielokrotnie

### 3.3 Analityka embeddingowa
- [ ] **Wizualizacja t-SNE/UMAP** z kolorowaniem po kategoriach (juz czesciowo jest w Explore)
- [ ] Metryka separacji klastrow — pokazac ze domain-adapted encoder daje lepiej separowalne klastry
- [ ] Porownanie: ten sam zbior danych z generic vs domain-adapted encoderem (opcjonalne, dla zaawansowanych)

### 3.4 Anomaly detection
- [ ] Dokumenty daleko od wszystkich klastrow/kategorii — potencjalne nowe tematy lub outliers
- [ ] Alert: "Wykryto 15 dokumentow ktore nie pasuja do zadnej kategorii — czy to nowy temat?"
- [ ] Mozliwosc szybkiego utworzenia nowej kategorii z tych outlierow

---

## Faza 4 — Produkcyjna gotowosc

### 4.1 Asynchroniczne przetwarzanie
- [ ] Pelne kolejkowanie zadan w Redis (juz czesciowo jest)
- [ ] Limity wspolbieznosci — max N rownoczesnych zadan treningowych (zasoby GPU/CPU)
- [ ] Estymacja czasu — "Trening potrwa ok. 2-5 minut" na podstawie rozmiaru danych
- [ ] Notyfikacja po zakonczeniu (email lub w-app)

### 4.2 API z dokumentacja
- [ ] Swagger/OpenAPI juz jest (FastAPI generuje automatycznie) — uporzadkowac endpointy
- [ ] Mozliwosc uzycia API programistycznie (np. z Pythona, curl) bez frontendu
- [ ] Klucze API / basic auth na endpointy

### 4.3 Zarzadzanie dostepem (dalszy etap)
- [ ] Uzytkownicy i grupy
- [ ] Kazda grupa widzi swoje taksonomie, modele i wyniki
- [ ] Role: viewer (tylko przeglada), editor (trenuje modele), admin (zarzadza uzytkownikami)

### 4.4 Persystencja i eksport
- [ ] Eksport wynikow: CSV (jest), Excel, JSON, PDF raport
- [ ] Historia sesji — mozliwosc powrotu do wczesniejszych analiz
- [ ] Backup/restore taksonomii i modeli

---

## Faza 5 — Refaktor techniczny

- [ ] **Frontend**: wydzielic reuzywalne komponenty (DataTable, FileUploader, StepLayout, ConfirmDialog)
- [ ] **Walidacja train/test split** w SetFit — walidacja na held-out zbiorze, nie na danych treningowych
- [ ] **Testy** — unit testy backend (pytest), testy integracyjne endpointow, testy komponentow React
- [ ] **Error handling** — ujednolicenie bledow backend → frontend, toast notifications zamiast cichych failow
- [ ] **i18n** — przygotowanie pod wielojezycznosc (teraz hardcoded polski)

---

## Decyzje podjete

| Pytanie | Decyzja | Uzasadnienie |
|---------|---------|--------------|
| Django vs FastAPI? | **FastAPI** | Juz dziala, async natywnie, lepszy fit do ML pipeline, Swagger out-of-box |
| Gdzie trzymac modele? | **Filesystem + Redis metadata** | Juz zaimplementowane, proste, wystarczajace na obecnym etapie |
| SetFit vs fine-tuning? | **SetFit (few-shot)** | Kluczowa przewaga encodera — dziala z 5-10 przykladami na klase, pracownik banku nie ma tysiecy labelowanych danych |
| Priorytet faz? | **0 → 1 → 2 → 3** | Napierw naprawic co jest zepsute, potem UX, potem killer feature (active learning), potem showcase |
