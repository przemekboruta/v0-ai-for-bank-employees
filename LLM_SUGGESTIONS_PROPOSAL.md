# Propozycje nowych sugestii LLM dla Topic Discovery Hub

## Obecne sugestie (zachowane)
1. **MERGE** - łączenie podobnych tematycznie klastrów
2. **RENAME** - zmiana nazwy niejasnego/nieadekwatnego klastra
3. **RECLASSIFY** - podział jednego lub więcej klastrów na mniejsze, bardziej spójne grupy

## Proponowane nowe sugestie

### 1. **DELETE** (Usunięcie)
- **Opis**: Sugeruje usunięcie klastra, który jest:
  - Zbyt mały (np. < 3 dokumenty)
  - Składa się głównie z szumu/outlierów
  - Jest duplikatem innego klastra
  - Ma bardzo niską koherencję (< 0.3)
- **Parametry**:
  - `targetClusterIds`: [clusterId] - pojedynczy klaster do usunięcia
  - `suggestedAction`: "move_to_noise" | "merge_with" | "delete" - co zrobić z dokumentami
- **Użycie**: Pomaga w czyszczeniu wyników klasteryzacji

### 2. **EXTRACT** (Wyodrębnienie)
- **Opis**: Sugeruje wyodrębnienie podgrupy dokumentów z dużego klastra do osobnego klastra
  - Gdy klaster jest zbyt duży i heterogeniczny
  - Gdy część dokumentów wyraźnie różni się tematycznie od reszty
- **Parametry**:
  - `targetClusterIds`: [clusterId] - klaster źródłowy
  - `suggestedNumClusters`: number - sugerowana liczba nowych klastrów (domyślnie 2)
- **Użycie**: Podobne do reclassify, ale dla pojedynczego klastra

### 3. **CONSOLIDATE** (Konsolidacja)
- **Opis**: Sugeruje połączenie wielu małych, podobnych klastrów w jeden większy
  - Gdy jest wiele małych klastrów (< 5 dokumentów) o podobnej tematyce
  - Gdy można uprościć strukturę bez utraty jakości
- **Parametry**:
  - `targetClusterIds`: [clusterId1, clusterId2, ...] - lista małych klastrów do konsolidacji
  - `suggestedLabel`: string - sugerowana nazwa dla nowego klastra
- **Użycie**: Odwrotność reclassify - łączy zamiast dzielić

### 4. **REBALANCE** (Przebalansowanie)
- **Opis**: Sugeruje globalną reklasyfikację, gdy struktura klastrów jest niezrównoważona
  - Gdy są bardzo duże różnice w rozmiarach klastrów
  - Gdy wiele dokumentów jest w szumie, ale mogłyby być sklasyfikowane
  - Gdy ogólna koherencja jest niska
- **Parametry**:
  - `targetClusterIds`: [clusterId1, clusterId2, ...] - lista wszystkich klastrów do przebalansowania (lub pusta = wszystkie)
  - `suggestedNumClusters`: number - sugerowana nowa liczba klastrów
- **Użycie**: Globalna optymalizacja struktury

### 5. **HIERARCHY** (Hierarchia)
- **Opis**: Sugeruje utworzenie hierarchicznej struktury klastrów (nad-klastry i pod-klastry)
  - Gdy klastry można pogrupować w większe kategorie
  - Gdy struktura jest płaska, ale mogłaby być bardziej zorganizowana
- **Parametry**:
  - `targetClusterIds`: [clusterId1, clusterId2, ...] - klastry do pogrupowania
  - `suggestedParentLabel`: string - nazwa nad-klastra
  - `suggestedNumSubclusters`: number - liczba pod-klastrów
- **Użycie**: Tworzenie struktury wielopoziomowej

### 6. **NOISE_RECLASSIFY** (Reklasyfikacja szumu)
- **Opis**: Sugeruje próbę sklasyfikowania dokumentów obecnie w szumie
  - Gdy jest dużo dokumentów w szumie (> 10% wszystkich)
  - Gdy dokumenty ze szumu mogą pasować do istniejących klastrów
- **Parametry**:
  - `targetClusterIds`: [] - puste (szum)
  - `suggestedAction`: "assign_to_existing" | "create_new" - co zrobić z dokumentami
- **Użycie**: Redukcja szumu

## Priorytety implementacji

### Wysoki priorytet:
1. **DELETE** - proste, użyteczne, łatwe do implementacji
2. **NOISE_RECLASSIFY** - ważne dla jakości wyników

### Średni priorytet:
3. **EXTRACT** - podobne do reclassify, ale dla pojedynczego klastra
4. **CONSOLIDATE** - użyteczne dla uproszczenia struktury

### Niski priorytet:
5. **REBALANCE** - bardziej złożone, może być mylące dla użytkownika
6. **HIERARCHY** - wymaga większych zmian w strukturze danych

## Uwagi implementacyjne

- Wszystkie nowe sugestie powinny mieć pole `confidence` (0.0-1.0)
- Sugestie powinny być generowane tylko gdy są rzeczywiście potrzebne (nie za każdym razem)
- Można dodać pole `priority` do sugestii, aby sortować je według ważności
- Dla DELETE i NOISE_RECLASSIFY warto dodać pole `reason` z wyjaśnieniem, dlaczego sugestia została wygenerowana

