"use client"

import React from "react"

import { useCallback, useState } from "react"
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
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          className={`glass-interactive flex cursor-pointer flex-col items-center gap-5 rounded-2xl px-8 py-16 transition-all ${
            isDragging
              ? "border-primary/30 bg-primary/[0.06] glow-primary"
              : ""
          }`}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 glow-primary">
            <Upload className="h-7 w-7 text-primary" />
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <p className="text-sm font-medium text-foreground">
              Przeciagnij plik tutaj
            </p>
            <p className="text-xs text-muted-foreground">
              CSV, TXT (max 10MB)
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
        <div className="glass flex items-center justify-between rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 glow-accent">
              <FileText className="h-5 w-5 text-accent" />
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
            className="text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </Button>
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
