"use client"

import { useState } from "react"
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
import { ClusterScatterPlot } from "./cluster-scatter-plot"
import { Download, Map, TableIcon, BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"

interface StepExploreProps {
  result: ClusteringResult
}

export function StepExplore({ result }: StepExploreProps) {
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null)
  const [, setHoveredDoc] = useState<DocumentItem | null>(null)

  const filteredDocs = selectedTopicId !== null
    ? result.documents.filter((d) => d.clusterId === selectedTopicId)
    : result.documents

  const selectedTopic = selectedTopicId !== null
    ? result.topics.find((t) => t.id === selectedTopicId)
    : null

  const handleExport = () => {
    const header = "tekst,kategoria,id_kategorii"
    const rows = result.documents.map((doc) => {
      const topic = result.topics.find((t) => t.id === doc.clusterId)
      return `"${doc.text.replace(/"/g, '""')}","${topic?.label ?? ""}",${doc.clusterId}`
    })
    const csv = [header, ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "klasteryzacja_wyniki.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top: Stats Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Mapa tematow
          </h2>
          <p className="text-sm text-muted-foreground">
            {result.totalDocuments} dokumentow w {result.topics.length}{" "}
            kategoriach
            {selectedTopic && (
              <span>
                {" / "}
                Filtr:{" "}
                <span className="font-medium text-primary">
                  {selectedTopic.label}
                </span>
              </span>
            )}
          </p>
        </div>
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
          <span className="opacity-60">({result.totalDocuments})</span>
        </button>
        {result.topics.map((topic) => (
          <button
            key={topic.id}
            type="button"
            onClick={() =>
              setSelectedTopicId(
                selectedTopicId === topic.id ? null : topic.id
              )
            }
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
            {topic.label}
            <span className="opacity-50">({topic.documentCount})</span>
          </button>
        ))}
      </div>

      <Tabs defaultValue="map" className="w-full">
        <TabsList className="glass-subtle border-white/[0.06] bg-white/[0.03]">
          <TabsTrigger value="map" className="gap-1.5 data-[state=active]:bg-white/[0.08] data-[state=active]:text-foreground">
            <Map className="h-3.5 w-3.5" />
            Mapa
          </TabsTrigger>
          <TabsTrigger value="table" className="gap-1.5 data-[state=active]:bg-white/[0.08] data-[state=active]:text-foreground">
            <TableIcon className="h-3.5 w-3.5" />
            Tabela
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-1.5 data-[state=active]:bg-white/[0.08] data-[state=active]:text-foreground">
            <BarChart3 className="h-3.5 w-3.5" />
            Statystyki
          </TabsTrigger>
        </TabsList>

        <TabsContent value="map" className="mt-4">
          <ClusterScatterPlot
            result={result}
            selectedTopicId={selectedTopicId}
            onTopicSelect={setSelectedTopicId}
            onDocumentHover={setHoveredDoc}
          />
        </TabsContent>

        <TabsContent value="table" className="mt-4">
          <div className="glass overflow-hidden rounded-2xl">
            <ScrollArea className="h-[460px]">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent">
                    <TableHead className="w-16 text-muted-foreground">Nr</TableHead>
                    <TableHead className="text-muted-foreground">Tekst</TableHead>
                    <TableHead className="w-48 text-muted-foreground">Kategoria</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocs.slice(0, 50).map((doc, idx) => {
                    const topic = result.topics.find(
                      (t) => t.id === doc.clusterId
                    )
                    return (
                      <TableRow key={doc.id} className="border-white/[0.04] hover:bg-white/[0.03]">
                        <TableCell className="text-xs text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="max-w-md text-sm text-foreground/80">
                          {doc.text.length > 100
                            ? `${doc.text.substring(0, 100)}...`
                            : doc.text}
                        </TableCell>
                        <TableCell>
                          {topic && (
                            <Badge
                              variant="secondary"
                              className="gap-1.5 border-0 bg-white/[0.06] text-foreground/70"
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor: topic.color,
                                }}
                              />
                              {topic.label.length > 20
                                ? `${topic.label.substring(0, 18)}...`
                                : topic.label}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
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
                  selectedTopicId === topic.id && "border-white/[0.15] glow-primary"
                )}
                onClick={() =>
                  setSelectedTopicId(
                    selectedTopicId === topic.id ? null : topic.id
                  )
                }
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: topic.color }}
                    />
                    <span className="text-sm font-semibold text-foreground">
                      {topic.label}
                    </span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="font-display text-3xl font-bold text-foreground">
                        {topic.documentCount}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        dokumentow
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
                  {/* Glass progress bar */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${(topic.documentCount / result.totalDocuments) * 100}%`,
                        backgroundColor: topic.color,
                        boxShadow: `0 0 8px ${topic.color}40`,
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {topic.keywords.slice(0, 3).map((kw) => (
                      <Badge
                        key={kw}
                        variant="secondary"
                        className="bg-white/[0.05] text-[10px] text-muted-foreground border-0"
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
    </div>
  )
}
