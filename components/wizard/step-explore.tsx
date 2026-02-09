"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
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
  const [hoveredDoc, setHoveredDoc] = useState<DocumentItem | null>(null)

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
                <span className="font-medium text-foreground">
                  {selectedTopic.label}
                </span>
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2 bg-transparent" onClick={handleExport}>
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
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
            selectedTopicId === null
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:border-primary/30"
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
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
              selectedTopicId === topic.id
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary/30"
            )}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: topic.color }}
            />
            {topic.label}
            <span className="opacity-60">({topic.documentCount})</span>
          </button>
        ))}
      </div>

      <Tabs defaultValue="map" className="w-full">
        <TabsList>
          <TabsTrigger value="map" className="gap-1.5">
            <Map className="h-3.5 w-3.5" />
            Mapa
          </TabsTrigger>
          <TabsTrigger value="table" className="gap-1.5">
            <TableIcon className="h-3.5 w-3.5" />
            Tabela
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-1.5">
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
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-[460px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Nr</TableHead>
                      <TableHead>Tekst</TableHead>
                      <TableHead className="w-48">Kategoria</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocs.slice(0, 50).map((doc, idx) => {
                      const topic = result.topics.find(
                        (t) => t.id === doc.clusterId
                      )
                      return (
                        <TableRow key={doc.id}>
                          <TableCell className="text-xs text-muted-foreground">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="max-w-md text-sm">
                            {doc.text.length > 100
                              ? `${doc.text.substring(0, 100)}...`
                              : doc.text}
                          </TableCell>
                          <TableCell>
                            {topic && (
                              <Badge
                                variant="secondary"
                                className="gap-1.5"
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="mt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {result.topics.map((topic) => (
              <Card
                key={topic.id}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-md",
                  selectedTopicId === topic.id && "ring-1 ring-primary/30"
                )}
                onClick={() =>
                  setSelectedTopicId(
                    selectedTopicId === topic.id ? null : topic.id
                  )
                }
              >
                <CardContent className="flex flex-col gap-3 p-4">
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
                      <p className="text-2xl font-bold text-foreground">
                        {topic.documentCount}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        dokumentow
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-foreground">
                        {Math.round(topic.coherenceScore * 100)}%
                      </p>
                      <p className="text-xs text-muted-foreground">
                        koherencja
                      </p>
                    </div>
                  </div>
                  {/* Simple bar visualization */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(topic.documentCount / result.totalDocuments) * 100}%`,
                        backgroundColor: topic.color,
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {topic.keywords.slice(0, 3).map((kw) => (
                      <Badge
                        key={kw}
                        variant="secondary"
                        className="text-[10px]"
                      >
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
