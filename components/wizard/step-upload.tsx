"use client"

import React from "react"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Upload, FileText, X, Database, Columns, Eye, ChevronDown } from "lucide-react"
import { generateSampleTexts } from "@/lib/mock-clustering"
import { cn } from "@/lib/utils"
import { StepHelpBox } from "@/components/wizard/step-help-box"
import * as XLSX from "xlsx"

interface StepUploadProps {
  onTextsLoaded: (texts: string[]) => void
  loadedCount: number
}

interface ParsedCSV {
  headers: string[]
  rows: string[][]
  raw: string
}

/** Split content into lines; newlines inside double-quoted fields are preserved (RFC 4180). */
function splitCSVRows(content: string): string[] {
  const rows: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (c === '"') {
      inQuotes = !inQuotes
      current += c
    } else if (!inQuotes && (c === "\n" || (c === "\r" && content[i + 1] === "\n"))) {
      rows.push(current)
      current = ""
      if (c === "\r") i++
    } else {
      current += c
    }
  }
  if (current.length > 0) rows.push(current)
  return rows
}

/** Parse a single CSV row into fields; delimiter inside double-quoted fields is preserved. */
function parseCSVRow(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (!inQuotes && c === delimiter) {
      fields.push(unquoteField(current))
      current = ""
    } else {
      current += c
    }
  }
  fields.push(unquoteField(current))
  return fields
}

function unquoteField(s: string): string {
  s = s.trim()
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).replace(/""/g, '"')
  }
  return s
}

function parseCSV(content: string): ParsedCSV | null {
  const rawRows = splitCSVRows(content).map((r) => r.trim()).filter((r) => r.length > 0)
  if (rawRows.length < 2) return null

  const firstRowStr = rawRows[0]
  const secondRowStr = rawRows[1]
  const tryDelimiter = (delim: string) => parseCSVRow(firstRowStr, delim).length
  const tabCols = tryDelimiter("\t")
  const semicolonCols = tryDelimiter(";")
  const commaCols = tryDelimiter(",")
  const delimiter =
    tabCols > 1 && tabCols >= semicolonCols && tabCols >= commaCols
      ? "\t"
      : semicolonCols > 1 && semicolonCols >= commaCols
        ? ";"
        : ","

  const headers = parseCSVRow(firstRowStr, delimiter).map((h) => h.replace(/^["']|["']$/g, "").trim())
  if (headers.length <= 1) return null

  const rows = rawRows.slice(1).map((line) => parseCSVRow(line, delimiter))

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

  const parseXLSX = useCallback((arrayBuffer: ArrayBuffer): ParsedCSV | null => {
    const workbook = XLSX.read(arrayBuffer, { type: "array" })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) return null
    const sheet = workbook.Sheets[firstSheetName]
    const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
    if (data.length < 2) return null
    const headers = (data[0] as unknown[]).map((c) => String(c ?? "").trim())
    if (headers.length <= 1) return null
    const rows = data.slice(1).map((row) =>
      (row as unknown[]).map((cell) => {
        const v = cell ?? ""
        return typeof v === "string" ? v : String(v)
      })
    )
    return { headers, rows, raw: "" }
  }, [])

  const handleFile = useCallback(
    (file: File) => {
      const isXLSX = /\.xlsx$/i.test(file.name)
      if (isXLSX) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const arrayBuffer = e.target?.result as ArrayBuffer
          if (!arrayBuffer) return
          const parsed = parseXLSX(arrayBuffer)
          if (parsed && parsed.headers.length > 1) {
            setFileName(file.name)
            setParsedCSV(parsed)
            setSelectedColumn(null)
            setPreviewTexts([])
            onTextsLoaded([])
          } else if (parsed && parsed.rows.length > 0) {
            const singleCol = parsed.rows.map((row) => (row[0] ?? "").trim()).filter((t) => t.length > 0)
            setFileName(file.name)
            setParsedCSV(null)
            setPreviewTexts(singleCol)
            onTextsLoaded(singleCol)
          } else {
            setFileName(file.name)
            setParsedCSV(null)
            setPreviewTexts([])
            onTextsLoaded([])
          }
        }
        reader.readAsArrayBuffer(file)
        return
      }
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
    [onTextsLoaded, handlePlainText, parseXLSX]
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
          Wgraj plik z tekstami, ktore chcesz przeanalizowac lub sklasyfikowac.
        </p>
      </div>

      <StepHelpBox title="Jak przygotowac dane?">
        <ul className="list-disc space-y-1 pl-4">
          <li>Zaladuj plik CSV, XLSX lub TXT z tekstami dokumentow (np. tresc reklamacji, korespondencja).</li>
          <li>W pliku CSV/XLSX wybierzesz kolumne zawierajaca tekst — kazdy wiersz to jeden dokument.</li>
          <li>Optymalna liczba dokumentow: <strong>100–5000</strong>. Mniej niz 50 moze dac slabe wyniki clusteringu.</li>
          <li>Mozesz tez uzyc przykladowych danych bankowych, zeby zobaczyc jak dziala aplikacja.</li>
        </ul>
      </StepHelpBox>

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
              CSV, XLSX, TXT, TSV (max 10MB)
            </p>
          </div>
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".csv,.txt,.tsv,.xlsx"
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
                    ? `${loadedCount} tekstów załadowanych`
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
              aria-label="Usuń plik"
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
                  <p className="text-sm font-medium text-foreground">Wybierz kolumnę do analizy</p>
                  <p className="text-xs text-muted-foreground">
                    Wykryto {parsedCSV.headers.length} kolumn. Wskaż, która zawiera teksty do klasteryzacji.
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
                      : "Kliknij, aby wybrać kolumnę..."}
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
                                Przykład: &quot;{sampleValue.substring(0, 80)}{sampleValue.length > 80 ? "..." : ""}&quot;
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
                      {previewTexts.length} tekstów gotowych do analizy
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
                          ...i {previewTexts.length - 20} więcej
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
        Użyj przykładowych danych bankowych
      </Button>
    </div>
  )
}
