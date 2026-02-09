import type {
  Granularity,
  DocumentItem,
  ClusterTopic,
  LLMSuggestion,
  ClusteringResult,
} from "./clustering-types"
import { CLUSTER_COLORS } from "./clustering-types"

const BANKING_TOPICS: Record<
  string,
  { label: string; description: string; keywords: string[]; samples: string[] }
> = {
  card_complaint: {
    label: "Reklamacja karty platniczej",
    description:
      "Zgłoszenia dotyczace nieautoryzowanych transakcji, blokad kart, problemow z platami zblizeniowymi",
    keywords: ["karta", "transakcja", "blokada", "platnosc", "nieautoryzowana"],
    samples: [
      "Zauwazylem na koncie transakcje, ktorej nie dokonywalem. Prosze o wyjasnienie i zwrot srodkow.",
      "Moja karta zostala zablokowana po trzech blednych probach PIN. Prosze o odblokowanie.",
      "Platnosc zblizeniowa nie przeszla mimo wystarczajacych srodkow na koncie.",
      "Prosze o reklamacje podwojnie naliczonej transakcji w sklepie internetowym.",
      "Karta nie dziala za granica pomimo wczesniejszego zgloszenia wyjazdu.",
    ],
  },
  credit: {
    label: "Pytania o kredyt",
    description:
      "Zapytania o warunki kredytow hipotecznych, gotowkowych, raty i oplate",
    keywords: ["kredyt", "rata", "oprocentowanie", "hipoteczny", "gotowkowy"],
    samples: [
      "Chcialabym dowiedziec sie o aktualne oprocentowanie kredytu hipotecznego.",
      "Czy mogę zmienić dzien splaty raty kredytowej z 15 na 1 kazdego miesiaca?",
      "Jakie dokumenty sa potrzebne do zlozenia wniosku o kredyt gotowkowy?",
      "Prosze o informacje o mozliwosci wczesniejszej splaty kredytu bez dodatkowych oplat.",
      "Czy moge zwiekszyc kwote kredytu odnawialnego?",
    ],
  },
  account_opening: {
    label: "Otwarcie konta",
    description:
      "Pytania o procedure otwierania kont osobistych, firmowych i oszczednosciowych",
    keywords: ["konto", "otwarcie", "osobiste", "firmowe", "dokumenty"],
    samples: [
      "Jakie sa wymagania do otwarcia konta osobistego dla osoby nieletniej?",
      "Czy moge otworzyc konto firmowe calkowicie online?",
      "Jakie konto oszczednosciowe polecacie z najlepszym oprocentowaniem?",
      "Chcialabym otworzyc konto walutowe w EUR. Jakie sa oplaty?",
      "Czy do otwarcia konta potrzebuje meldunku?",
    ],
  },
  transfer_issues: {
    label: "Problemy z przelewami",
    description:
      "Zgloszenia dotyczace opoznien, bledow i problemow z realizacja przelewow krajowych i zagranicznych",
    keywords: ["przelew", "opoznienie", "SWIFT", "BLIK", "elixir"],
    samples: [
      "Przelew wewnetrzny nie dotarl do odbiorcy mimo uplywu 3 dni roboczych.",
      "Przelew SWIFT do USA zostal zwrocony. Prosze o wyjaśnienie powodu.",
      "BLIK nie dziala - nie moge wyslac pieniedzy do znajomego.",
      "Zrobilem przelew na bledny numer konta. Czy mozna go cofnac?",
      "Przelew natychmiastowy nie zostal zaksiegowany mimo potwierdzenia.",
    ],
  },
  mobile_app: {
    label: "Problemy z aplikacja mobilna",
    description:
      "Zgloszenia dotyczace bledow, awarii i trudnosci z uzytkowaniem aplikacji bankowej",
    keywords: ["aplikacja", "logowanie", "blad", "aktualizacja", "mobilna"],
    samples: [
      "Nie moge sie zalogowac do aplikacji - wyswietla komunikat o bledzie serwera.",
      "Po aktualizacji aplikacji nie widze historii transakcji.",
      "Aplikacja zamyka sie sama przy probie wykonania przelewu.",
      "Jak wlaczyc powiadomienia push o transakcjach w nowej wersji aplikacji?",
      "Biometria na telefonie przestala dzialac po zmianie telefonu.",
    ],
  },
  insurance: {
    label: "Pytania o ubezpieczenia",
    description:
      "Zapytania o polisy ubezpieczeniowe, ochrone karty, ubezpieczenie kredytu",
    keywords: [
      "ubezpieczenie",
      "polisa",
      "ochrona",
      "wypadek",
      "rezygnacja",
    ],
    samples: [
      "Chcialabym zrezygnowac z ubezpieczenia dolaczonego do karty kredytowej.",
      "Jakie ubezpieczenie podrozy oferujecie z karta platynowa?",
      "Prosze o informacje o ubezpieczeniu na wypadek utraty pracy.",
      "Jak zlozyc roszczenie z ubezpieczenia od utraty karty?",
      "Czy ubezpieczenie kredytu hipotecznego jest obowiazkowe?",
    ],
  },
  fees: {
    label: "Reklamacja oplat i prowizji",
    description:
      "Skargi dotyczace nieoczekiwanych oplat, zmian taryf i prowizji za uslugi bankowe",
    keywords: ["oplata", "prowizja", "taryfa", "naliczenie", "zwrot"],
    samples: [
      "Zostala mi naliczona oplata za prowadzenie konta mimo spelnienia warunkow zwolnienia.",
      "Dlaczego prowizja za wyplate z bankomatu wzrosla bez powiadomienia?",
      "Prosze o zwrot oplaty za wydanie duplikatu karty - nie zostalam poinformowana o koszcie.",
      "Reklamuje naliczenie oplaty za przelew natychmiastowy - mialem pakiet darmowych.",
      "Zmieniliscie taryfe bez powiadomienia mnie z 30-dniowym wyprzedzeniem.",
    ],
  },
  online_banking: {
    label: "Bankowosc internetowa",
    description:
      "Problemy z dosteeem do systemu online, tokeny, autoryzacja transakcji",
    keywords: ["bankowosc", "online", "token", "haslo", "autoryzacja"],
    samples: [
      "Zapomnialem hasla do bankowosci internetowej. Jak moge je zresetowac?",
      "Token sprzetowy nie generuje kodow - wyswietla blad.",
      "Nie moge autoryzowac przelewu - SMS z kodem nie przychodzi.",
      "Jak dodac nowego beneficjenta do listy zaufanych odbiorcow online?",
      "System bankowosci online nie laduje sie na przegladarce Safari.",
    ],
  },
}

const EXTRA_TOPICS_LOW: string[] = [
  "card_complaint",
  "credit",
  "transfer_issues",
  "mobile_app",
]
const EXTRA_TOPICS_MED: string[] = [
  "card_complaint",
  "credit",
  "account_opening",
  "transfer_issues",
  "mobile_app",
  "fees",
]
const EXTRA_TOPICS_HIGH: string[] = Object.keys(BANKING_TOPICS)

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function gaussianRandom(rng: () => number): number {
  const u = 1 - rng()
  const v = rng()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

export function generateMockClustering(
  texts: string[],
  granularity: Granularity,
  seed: number = 42,
): ClusteringResult {
  const rng = seededRandom(seed)

  const topicKeys =
    granularity === "low"
      ? EXTRA_TOPICS_LOW
      : granularity === "medium"
        ? EXTRA_TOPICS_MED
        : EXTRA_TOPICS_HIGH

  const numTopics = topicKeys.length

  // Generate cluster centroids spread around the 2D space
  const centroids: { x: number; y: number }[] = []
  const angleStep = (2 * Math.PI) / numTopics
  for (let i = 0; i < numTopics; i++) {
    const angle = angleStep * i + (rng() - 0.5) * 0.5
    const radius = 25 + rng() * 15
    centroids.push({
      x: 50 + radius * Math.cos(angle),
      y: 50 + radius * Math.sin(angle),
    })
  }

  // Assign texts to clusters
  const documents: DocumentItem[] = texts.map((text, idx) => {
    const clusterId = idx % numTopics
    const centroid = centroids[clusterId]
    const spread = 6 + rng() * 4
    return {
      id: `doc-${idx}`,
      text,
      clusterId,
      x: centroid.x + gaussianRandom(rng) * spread,
      y: centroid.y + gaussianRandom(rng) * spread,
    }
  })

  // Build topics
  const topics: ClusterTopic[] = topicKeys.map((key, idx) => {
    const topicData = BANKING_TOPICS[key]
    const docsInCluster = documents.filter((d) => d.clusterId === idx)
    return {
      id: idx,
      label: topicData.label,
      description: topicData.description,
      documentCount: docsInCluster.length,
      sampleTexts: topicData.samples.slice(0, 3),
      color: CLUSTER_COLORS[idx % CLUSTER_COLORS.length],
      centroidX: centroids[idx].x,
      centroidY: centroids[idx].y,
      coherenceScore: 0.65 + rng() * 0.3,
      keywords: topicData.keywords,
    }
  })

  // Generate LLM suggestions
  const suggestions: LLMSuggestion[] = []

  if (numTopics >= 6) {
    suggestions.push({
      type: "merge",
      description: `Tematy "${topics[0].label}" i "${topics[5].label}" maja znaczace pokrycie tematyczne. Sugeruje polaczenie ich w jedna kategorie.`,
      targetClusterIds: [topics[0].id, topics[5].id],
      suggestedLabel: "Reklamacje finansowe",
      confidence: 0.82,
      applied: false,
    })
  }

  if (numTopics >= 4) {
    suggestions.push({
      type: "split",
      description: `Temat "${topics[1].label}" zawiera dwie wyrazne podgrupy: pytania o warunki oraz pytania o procedure. Sugeruje podzial.`,
      targetClusterIds: [topics[1].id],
      confidence: 0.74,
      applied: false,
    })
  }

  suggestions.push({
    type: "rename",
    description: `Nazwa "${topics[numTopics - 1].label}" moze byc niejasna dla pracownikow. Sugeruje bardziej opisowa nazwe.`,
    targetClusterIds: [topics[numTopics - 1].id],
    suggestedLabel:
      numTopics > 4
        ? "Problemy z logowaniem i dostepem online"
        : "Awarie i bledy aplikacji bankowej",
    confidence: 0.68,
    applied: false,
  })

  if (numTopics >= 5) {
    suggestions.push({
      type: "reclassify",
      description:
        "Wykryto 12 dokumentow, ktore moga byc lepiej dopasowane do innej kategorii. Dotycza one platnosci BLIK, ktore sa obecnie w kategorii przelewow, ale lepiej pasuja do kategorii aplikacji mobilnej.",
      targetClusterIds: [3, 4],
      confidence: 0.71,
      applied: false,
    })
  }

  return {
    documents,
    topics,
    llmSuggestions: suggestions,
    totalDocuments: texts.length,
    noise: Math.floor(texts.length * 0.02),
  }
}

export function generateSampleTexts(): string[] {
  const allSamples: string[] = []
  for (const topic of Object.values(BANKING_TOPICS)) {
    for (let i = 0; i < 3; i++) {
      for (const sample of topic.samples) {
        allSamples.push(i === 0 ? sample : `${sample} (wariant ${i + 1})`)
      }
    }
  }
  return allSamples
}
