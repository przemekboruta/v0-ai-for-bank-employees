"use client"

import React from "react"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Upload, FileText, X, Database, Columns, Eye, ChevronDown } from "lucide-react"
import { generateSampleTexts } from "@/lib/mock-clustering"
import { cn } from "@/lib/utils"

interface StepUploadProps {
  onTextsLoaded: (texts: string[]) => void
  loadedCount: number
}

interface ParsedCSV {
  headers: string[]
  rows: string[][]
  raw: string
}

function parseCSV(content: string): ParsedCSV | null {
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length < 2) return null

  // Detect delimiter
  const firstLine = lines[0]
  const semicolonCount = (firstLine.match(/;/g) || []).length
  const commaCount = (firstLine.match(/,/g) || []).length
  const tabCount = (firstLine.match(/\t/g) || []).length
  const delimiter = tabCount > commaCount && tabCount > semicolonCount ? "\t" : semicolonCount > commaCount ? ";" : ","

  const headers = firstLine.split(delimiter).map((h) => h.replace(/^["']|["']$/g, "").trim())

  // If only 1 column, it's plain text -- no column picker needed
  if (headers.length <= 1) return null

  const rows = lines.slice(1).map((line) =>
    line.split(delimiter).map((cell) => cell.replace(/^["']|["']$/g, "").trim())
  )

  return { headers, rows, raw: content }
}

export function StepUpload({ onTextsLoaded, loadedCount }: StepUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsedCSV, setParsedCSV] = useState<ParsedCSV | null>(null)
  const [selectedColumn, setSelectedColumn] = useState<number | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewTexts, setPreviewTexts] = useState<string[]>([])
  const [showColumnDropdown, setShowColumnDropdown] = useState(false)

  const loadTextsFromColumn = useCallback(
    (csv: ParsedCSV, colIdx: number) => {
      const texts = csv.rows
        .map((row) => row[colIdx] ?? "")
        .filter((t) => t.length > 0)
      setPreviewTexts(texts)
      onTextsLoaded(texts)
    },
    [onTextsLoaded]
  )

  const handlePlainText = useCallback(
    (content: string, name: string) => {
      const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      setFileName(name)
      setParsedCSV(null)
      setSelectedColumn(null)
      setPreviewTexts(lines)
      onTextsLoaded(lines)
    },
    [onTextsLoaded]
  )

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        const csv = parseCSV(content)

        if (csv && csv.headers.length > 1) {
          setFileName(file.name)
          setParsedCSV(csv)
          setSelectedColumn(null)
          setPreviewTexts([])
          onTextsLoaded([])
        } else {
          handlePlainText(content, file.name)
        }
      }
      reader.readAsText(file)
    },
    [onTextsLoaded, handlePlainText]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleDemoData = useCallback(() => {
    const samples = generateSampleTexts()
    setFileName("demo_dane_bankowe.csv")
    setParsedCSV(null)
    setSelectedColumn(null)
    setPreviewTexts(samples)
    onTextsLoaded(samples)
  }, [onTextsLoaded])

  const clearFile = useCallback(() => {
    setFileName(null)
    setParsedCSV(null)
    setSelectedColumn(null)
    setPreviewTexts([])
    setShowPreview(false)
    onTextsLoaded([])
  }, [onTextsLoaded])

  const selectColumn = useCallback(
    (colIdx: number) => {
      setSelectedColumn(colIdx)
      setShowColumnDropdown(false)
      if (parsedCSV) {
        loadTextsFromColumn(parsedCSV, colIdx)
      }
    },
    [parsedCSV, loadTextsFromColumn]
  )

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Wgraj dokumenty do analizy
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Wgraj plik CSV lub TXT z tekstami. System automatycznie wykryje
          kolumny w pliku CSV i pozwoli wybrac kolumne do analizy.
        </p>
      </div>

      {!fileName ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          className={cn(
            "glass-interactive flex cursor-pointer flex-col items-center gap-5 rounded-2xl px-8 py-16 transition-all",
            isDragging && "border-primary/30 bg-primary/[0.06] glow-primary"
          )}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 glow-primary">
            <Upload className="h-7 w-7 text-primary" />
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <p className="text-sm font-medium text-foreground">
              Przeciagnij plik tutaj
            </p>
            <p className="text-xs text-muted-foreground">
              CSV, TXT, TSV (max 10MB)
            </p>
          </div>
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".csv,.txt,.tsv"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
            />
            <span className="inline-flex h-9 items-center rounded-xl bg-primary/90 px-5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary hover:shadow-xl hover:shadow-primary/30">
              Wybierz plik
            </span>
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* File info */}
          <div className="glass flex items-center justify-between rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 glow-accent">
                <FileText className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {loadedCount > 0
                    ? `${loadedCount} tekstow zaladowanych`
                    : parsedCSV
                      ? `${parsedCSV.rows.length} wierszy, ${parsedCSV.headers.length} kolumn`
                      : "Przetwarzanie..."}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearFile}
              aria-label="Usun plik"
              className="text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Column picker */}
          {parsedCSV && (
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
                  <Columns className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Wybierz kolumne do analizy</p>
                  <p className="text-xs text-muted-foreground">
                    Wykryto {parsedCSV.headers.length} kolumn. Wskaż, ktora zawiera teksty do klasteryzacji.
                  </p>
                </div>
              </div>

              {/* Custom dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowColumnDropdown(!showColumnDropdown)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-all",
                    selectedColumn !== null
                      ? "border-primary/20 bg-primary/[0.06] text-foreground"
                      : "border-white/[0.1] bg-white/[0.03] text-muted-foreground"
                  )}
                >
                  <span>
                    {selectedColumn !== null
                      ? parsedCSV.headers[selectedColumn]
                      : "Kliknij, aby wybrac kolumne..."}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showColumnDropdown && "rotate-180")} />
                </button>

                {showColumnDropdown && (
                  <div className="glass-strong absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl">
                    <ScrollArea className="max-h-64">
                      {parsedCSV.headers.map((header, idx) => {
                        const sampleValue = parsedCSV.rows[0]?.[idx] ?? ""
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => selectColumn(idx)}
                            className={cn(
                              "flex w-full flex-col gap-1 border-b border-white/[0.04] px-4 py-3 text-left transition-all hover:bg-white/[0.06]",
                              selectedColumn === idx && "bg-primary/[0.08]"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{header}</span>
                              <Badge variant="secondary" className="bg-white/[0.06] text-[10px] text-muted-foreground border-0">
                                kolumna {idx + 1}
                              </Badge>
                            </div>
                            {sampleValue && (
                              <p className="text-xs text-muted-foreground truncate">
                                Przyklad: &quot;{sampleValue.substring(0, 80)}{sampleValue.length > 80 ? "..." : ""}&quot;
                              </p>
                            )}
                          </button>
                        )
                      })}
                    </ScrollArea>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preview */}
          {previewTexts.length > 0 && (
            <div className="glass rounded-2xl p-5">
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className="flex w-full items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
                    <Eye className="h-4 w-4 text-accent" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-foreground">
                      Podglad danych
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {previewTexts.length} tekstow gotowych do analizy
                    </p>
                  </div>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showPreview && "rotate-180")} />
              </button>

              {showPreview && (
                <div className="mt-4 border-t border-white/[0.06] pt-4">
                  <ScrollArea className="h-48">
                    <div className="flex flex-col gap-2 pr-3">
                      {previewTexts.slice(0, 20).map((text, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-3 rounded-lg bg-white/[0.03] px-3 py-2.5"
                        >
                          <span className="shrink-0 text-[10px] font-medium text-muted-foreground mt-0.5">
                            {idx + 1}
                          </span>
                          <p className="text-xs leading-relaxed text-foreground/80">
                            {text.length > 150 ? `${text.substring(0, 150)}...` : text}
                          </p>
                        </div>
                      ))}
                      {previewTexts.length > 20 && (
                        <p className="text-center text-xs text-muted-foreground py-2">
                          ...i {previewTexts.length - 20} wiecej
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="relative flex items-center gap-4">
        <div className="h-px flex-1 bg-white/[0.06]" />
        <span className="text-xs font-medium text-muted-foreground">lub</span>
        <div className="h-px flex-1 bg-white/[0.06]" />
      </div>

      <Button
        variant="outline"
        className="gap-2 rounded-xl border-white/[0.1] bg-transparent text-muted-foreground hover:border-white/[0.2] hover:text-foreground hover:bg-white/[0.04]"
        onClick={handleDemoData}
      >
        <Database className="h-4 w-4" />
        Uzyj przykladowych danych bankowych
      </Button>
    </div>
  )
}
