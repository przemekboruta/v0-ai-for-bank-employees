"use client"

import React from "react"

import { useCallback, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, FileText, X, Database } from "lucide-react"
import { generateSampleTexts } from "@/lib/mock-clustering"

interface StepUploadProps {
  onTextsLoaded: (texts: string[]) => void
  loadedCount: number
}

export function StepUpload({ onTextsLoaded, loadedCount }: StepUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  const handleFile = useCallback(
    (file: File) => {
      setFileName(file.name)
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        const lines = content
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
        onTextsLoaded(lines)
      }
      reader.readAsText(file)
    },
    [onTextsLoaded]
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
    onTextsLoaded(samples)
  }, [onTextsLoaded])

  const clearFile = useCallback(() => {
    setFileName(null)
    onTextsLoaded([])
  }, [onTextsLoaded])

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Wgraj dokumenty do analizy
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Wgraj plik CSV lub TXT z tekstami (jeden tekst na linie). System
          automatycznie wykryje kategorie tematyczne w Twoich danych.
        </p>
      </div>

      {!fileName ? (
        <Card
          className={`border-2 border-dashed transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40"
          }`}
        >
          <CardContent className="p-0">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              className="flex flex-col items-center gap-4 py-16"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Upload className="h-6 w-6 text-primary" />
              </div>
              <div className="flex flex-col items-center gap-1">
                <p className="text-sm font-medium text-foreground">
                  Przeciagnij plik tutaj
                </p>
                <p className="text-xs text-muted-foreground">
                  CSV, TXT (max 10MB)
                </p>
              </div>
              <div className="flex items-center gap-3">
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
                  <span className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    Wybierz plik
                  </span>
                </label>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {loadedCount} tekstow zaladowanych
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={clearFile}
                aria-label="Usun plik"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative flex items-center gap-4">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium text-muted-foreground">lub</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Button
        variant="outline"
        className="gap-2 bg-transparent"
        onClick={handleDemoData}
      >
        <Database className="h-4 w-4" />
        Uzyj przykladowych danych bankowych
      </Button>
    </div>
  )
}
