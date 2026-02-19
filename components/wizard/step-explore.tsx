"use client"

import { useCallback, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ClusteringResult, DocumentItem } from "@/lib/clustering-types"
import { exportReport, downloadBlob, renameTopic as renameTopicApi } from "@/lib/api-client"
import { ClusterScatterPlot } from "./cluster-scatter-plot"
import { DocumentDetailDrawer } from "./document-detail-drawer"
import {
  Download,
  Map as MapIcon,
  TableIcon,
  BarChart3,
  Search,
  FileText,
  ClipboardCopy,
  Check,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface StepExploreProps {
  result: ClusteringResult
  onResultUpdate: (result: ClusteringResult) => void
}

export function StepExplore({ result, onResultUpdate }: StepExploreProps) {
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedDoc, setSelectedDoc] = useState<DocumentItem | null>(null)
  const [copiedReport, setCopiedReport] = useState(false)
  const [editingTopicId, setEditingTopicId] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState("")

  const activeDocuments = useMemo(
    () => result.documents.filter((d) => !d.excluded),
    [result.documents]
  )
  const excludedCount = result.documents.length - activeDocuments.length

  const filteredDocs = useMemo(() => {
    let docs = activeDocuments
    if (selectedTopicId !== null) {
      docs = docs.filter((d) => d.clusterId === selectedTopicId)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      docs = docs.filter((d) => d.text.toLowerCase().includes(q))
    }
    return docs
  }, [activeDocuments, selectedTopicId, searchQuery])

  const handleExcludeToggle = useCallback(
    (doc: DocumentItem, excluded: boolean) => {
      const docId = doc.id
      const updated = {
        ...result,
        documents: result.documents.map((d) =>
          d.id === docId ? { ...d, excluded } : d
        ),
      }
      onResultUpdate(updated)
      if (excluded && selectedDoc?.id === docId) {
        setSelectedDoc(null)
      } else if (!excluded && selectedDoc?.id === docId) {
        const next = updated.documents.find((d) => d.id === docId)
        if (next) setSelectedDoc(next)
      }
    },
    [result, onResultUpdate, selectedDoc?.id]
  )

  const resultForDisplay = useMemo(
    () => ({ ...result, documents: activeDocuments }),
    [result, activeDocuments]
  )

  const activeCountByTopic = useMemo(() => {
    const m = new Map<number, number>()
    for (const d of activeDocuments) {
      m.set(d.clusterId, (m.get(d.clusterId) ?? 0) + 1)
    }
    return m
  }, [activeDocuments])

  const selectedTopic =
    selectedTopicId !== null
      ? result.topics.find((t) => t.id === selectedTopicId)
      : null

  const selectedDocTopic = selectedDoc
    ? result.topics.find((t) => t.id === selectedDoc.clusterId) ?? null
    : null

  const handleExport = async () => {
    try {
      const resultToExport = { ...result, documents: activeDocuments }
      const blob = await exportReport(resultToExport, "csv", { language: "pl" })
      if (blob instanceof Blob) {
        downloadBlob(blob, "klasteryzacja_wyniki.csv")
      }
    } catch {
      const header = "tekst,kategoria,id_kategorii,koherencja"
      const rows = activeDocuments.map((doc) => {
        const topic = result.topics.find((t) => t.id === doc.clusterId)
        return `"${doc.text.replace(/"/g, '""')}","${topic?.label ?? ""}",${doc.clusterId},${topic?.coherenceScore ? Math.round(topic.coherenceScore * 100) : ""}`
      })
      const csv = [header, ...rows].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      downloadBlob(blob, "klasteryzacja_wyniki.csv")
    }
  }

  const generateReport = () => {
    const lines: string[] = []
    lines.push("RAPORT KLASTERYZACJI TEMATYCZNEJ")
    lines.push("================================")
    lines.push("")
    lines.push(`Data: ${new Date().toLocaleDateString("pl-PL")}`)
    lines.push(`Liczba dokumentów (w analizie): ${activeDocuments.length}`)
    if (excludedCount > 0) {
      lines.push(`Dokumenty wyłączone z analizy: ${excludedCount}`)
    }
    lines.push(`Liczba wykrytych kategorii: ${result.topics.length}`)
    lines.push(`Dokumenty nieskategoryzowane (szum): ${result.noise}`)
    lines.push("")
    lines.push("WYKRYTE KATEGORIE:")
    lines.push("-".repeat(40))
    lines.push("")

    const sorted = [...result.topics].sort(
      (a, b) => (activeCountByTopic.get(b.id) ?? 0) - (activeCountByTopic.get(a.id) ?? 0)
    )
    const totalActive = Math.max(1, activeDocuments.length)
    sorted.forEach((topic, idx) => {
      const count = activeCountByTopic.get(topic.id) ?? 0
      const pct = ((count / totalActive) * 100).toFixed(1)
      lines.push(`${idx + 1}. ${topic.label}`)
      lines.push(`   Dokumentow (w analizie): ${count} (${pct}%)`)
      lines.push(`   Koherencja: ${Math.round(topic.coherenceScore * 100)}%`)
      lines.push(`   Opis: ${topic.description}`)
      lines.push(`   Slowa kluczowe: ${topic.keywords.join(", ")}`)
      lines.push("")
    })

    lines.push("PRZYKLADY Z KAZDEJ KATEGORII:")
    lines.push("-".repeat(40))
    lines.push("")
    sorted.forEach((topic) => {
      lines.push(`[${topic.label}]`)
      topic.sampleTexts.forEach((s) => {
        lines.push(`  - ${s}`)
      })
      lines.push("")
    })

    return lines.join("\n")
  }

  const handleCopyReport = () => {
    const report = generateReport()
    navigator.clipboard.writeText(report).then(() => {
      setCopiedReport(true)
      setTimeout(() => setCopiedReport(false), 2000)
    })
  }

  const startRenaming = (topicId: number, currentLabel: string) => {
    setEditingTopicId(topicId)
    setEditingLabel(currentLabel)
  }

  const finishRenaming = async () => {
    if (editingTopicId === null || !editingLabel.trim()) {
      setEditingTopicId(null)
      return
    }
    // Wywolaj API (audit log, walidacja)
    try {
      await renameTopicApi(editingTopicId, editingLabel.trim())
    } catch {
      // Kontynuuj mimo bledu API -- zmiana lokalna wciaz dziala
    }
    const updated = { ...result }
    const topics = updated.topics.map((t) =>
      t.id === editingTopicId ? { ...t, label: editingLabel.trim() } : t
    )
    updated.topics = topics
    onResultUpdate(updated)
    setEditingTopicId(null)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Compact top bar: filters + export */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {selectedTopic && (
            <span>
              Kategoria: <span className="font-medium text-primary">{selectedTopic.label}</span>
              {" · "}
            </span>
          )}
          {searchQuery ? (
            <span>Szukaj: &quot;{searchQuery}&quot;</span>
          ) : (
            <span>
              {filteredDocs.length === activeDocuments.length
                ? `${activeDocuments.length} dokumentów`
                : `${filteredDocs.length} z ${activeDocuments.length} dokumentów`}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl border-white/[0.1] bg-transparent text-muted-foreground hover:border-white/[0.2] hover:text-foreground hover:bg-white/[0.04]"
            onClick={handleCopyReport}
          >
            {copiedReport ? (
              <Check className="h-4 w-4 text-accent" />
            ) : (
              <ClipboardCopy className="h-4 w-4" />
            )}
            {copiedReport ? "Skopiowano!" : "Raport"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl border-white/[0.1] bg-transparent text-muted-foreground hover:border-white/[0.2] hover:text-foreground hover:bg-white/[0.04]"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            Eksport CSV
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <div className="glass flex items-center gap-3 rounded-xl px-4 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="text"
          placeholder="Szukaj w treści dokumentów..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Wyczysc
          </button>
        )}
      </div>

      {/* Topic pills */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSelectedTopicId(null)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-300",
            selectedTopicId === null
              ? "border-primary/30 bg-primary/15 text-primary glow-primary"
              : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:border-white/[0.15] hover:bg-white/[0.06]"
          )}
        >
          Wszystkie
          <span className="opacity-60">({activeDocuments.length})</span>
        </button>
        {result.topics.map((topic) => (
          <button
            key={topic.id}
            type="button"
            onClick={() =>
              setSelectedTopicId(selectedTopicId === topic.id ? null : topic.id)
            }
            onDoubleClick={topic.id !== -1 ? () => startRenaming(topic.id, topic.label) : undefined}
            title={topic.id === -1 ? "Kategoria Szum (nazwa nie jest zmienialna)" : "Dwuklik aby zmienic nazwe"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-300",
              selectedTopicId === topic.id
                ? "border-white/[0.15] bg-white/[0.08] text-foreground"
                : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:border-white/[0.12] hover:bg-white/[0.05]"
            )}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: topic.color }}
            />
            {editingTopicId === topic.id && topic.id !== -1 ? (
              <input
                type="text"
                value={editingLabel}
                onChange={(e) => setEditingLabel(e.target.value)}
                onBlur={finishRenaming}
                onKeyDown={(e) => {
                  if (e.key === "Enter") finishRenaming()
                  if (e.key === "Escape") setEditingTopicId(null)
                }}
                className="w-32 bg-transparent text-xs text-foreground focus:outline-none"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              topic.label
            )}
            <span className="opacity-50">({topic.documentCount})</span>
          </button>
        ))}
      </div>

      <Tabs defaultValue="map" className="w-full">
        <TabsList className="glass-subtle border-white/[0.06] bg-white/[0.03]">
          <TabsTrigger
            value="map"
            className="gap-1.5 data-[state=active]:bg-white/[0.08] data-[state=active]:text-foreground"
          >
            <MapIcon className="h-3.5 w-3.5" />
            Mapa
          </TabsTrigger>
          <TabsTrigger
            value="table"
            className="gap-1.5 data-[state=active]:bg-white/[0.08] data-[state=active]:text-foreground"
          >
            <TableIcon className="h-3.5 w-3.5" />
            Tabela
          </TabsTrigger>
          <TabsTrigger
            value="stats"
            className="gap-1.5 data-[state=active]:bg-white/[0.08] data-[state=active]:text-foreground"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Statystyki
          </TabsTrigger>
        </TabsList>

        <TabsContent value="map" className="mt-4">
          <ClusterScatterPlot
            result={resultForDisplay}
            selectedTopicId={selectedTopicId}
            onTopicSelect={setSelectedTopicId}
            onDocumentClick={setSelectedDoc}
          />
        </TabsContent>

        <TabsContent value="table" className="mt-4">
          <div className="glass overflow-hidden rounded-2xl">
            <ScrollArea className="h-[460px]">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent">
                    <TableHead className="w-16 text-muted-foreground">
                      Nr
                    </TableHead>
                    <TableHead className="text-muted-foreground">
                      Tekst
                    </TableHead>
                    <TableHead className="w-48 text-muted-foreground">
                      Kategoria
                    </TableHead>
                    <TableHead className="w-16 text-muted-foreground" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocs.slice(0, 100).map((doc, idx) => {
                    const topic = result.topics.find(
                      (t) => t.id === doc.clusterId
                    )
                    return (
                      <TableRow
                        key={doc.id}
                        className="cursor-pointer border-white/[0.04] hover:bg-white/[0.03]"
                        onClick={() => setSelectedDoc(doc)}
                      >
                        <TableCell className="text-xs text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="max-w-md text-sm text-foreground/80">
                          {searchQuery ? (
                            <HighlightedText
                              text={
                                doc.text.length > 120
                                  ? `${doc.text.substring(0, 120)}...`
                                  : doc.text
                              }
                              query={searchQuery}
                            />
                          ) : doc.text.length > 120 ? (
                            `${doc.text.substring(0, 120)}...`
                          ) : (
                            doc.text
                          )}
                        </TableCell>
                        <TableCell>
                          {topic && (
                            <Badge
                              variant="secondary"
                              className="gap-1.5 border-0 bg-white/[0.06] text-foreground/70"
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: topic.color }}
                              />
                              {topic.label.length > 20
                                ? `${topic.label.substring(0, 18)}...`
                                : topic.label}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <FileText className="h-3.5 w-3.5 text-muted-foreground/50" />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {filteredDocs.length > 100 && (
                <div className="border-t border-white/[0.04] px-4 py-3 text-center text-xs text-muted-foreground">
                  Wyświetlono 100 z {filteredDocs.length} dokumentów. Użyj
                  wyszukiwania lub filtrow, aby zawezic wyniki.
                </div>
              )}
            </ScrollArea>
          </div>
        </TabsContent>

        <TabsContent value="stats" className="mt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {result.topics.map((topic) => (
              <div
                key={topic.id}
                className={cn(
                  "glass-interactive cursor-pointer rounded-2xl p-5",
                  selectedTopicId === topic.id &&
                    "border-white/[0.15] glow-primary"
                )}
                onClick={() =>
                  setSelectedTopicId(
                    selectedTopicId === topic.id ? null : topic.id
                  )
                }
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: topic.color }}
                      />
                      <span className="text-sm font-semibold text-foreground">
                        {topic.label}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    {topic.description}
                  </p>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="font-display text-3xl font-bold text-foreground">
                        {activeCountByTopic.get(topic.id) ?? 0}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        dokumentów (
                        {(
                          ((activeCountByTopic.get(topic.id) ?? 0) /
                            Math.max(1, activeDocuments.length)) *
                          100
                        ).toFixed(1)}
                        %)
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-xl font-semibold text-foreground">
                        {Math.round(topic.coherenceScore * 100)}%
                      </p>
                      <p className="text-xs text-muted-foreground">
                        koherencja
                      </p>
                    </div>
                  </div>
                  {/* Bar */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${((activeCountByTopic.get(topic.id) ?? 0) / Math.max(1, activeDocuments.length)) * 100}%`,
                        backgroundColor: topic.color,
                        boxShadow: `0 0 8px ${topic.color}40`,
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {topic.keywords.slice(0, 4).map((kw) => (
                      <Badge
                        key={kw}
                        variant="secondary"
                        className="border-0 bg-white/[0.05] text-[10px] text-muted-foreground"
                      >
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Document detail drawer */}
      <DocumentDetailDrawer
        document={selectedDoc}
        topic={selectedDocTopic}
        onClose={() => setSelectedDoc(null)}
        onExcludeToggle={handleExcludeToggle}
        allTopics={result.topics}
      />
    </div>
  )
}

function HighlightedText({
  text,
  query,
}: {
  text: string
  query: string
}) {
  if (!query.trim()) return <>{text}</>

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="rounded bg-primary/25 px-0.5 text-foreground"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}
