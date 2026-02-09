"use client"

import { useEffect, useState } from "react"
import { Progress } from "@/components/ui/progress"
import { Cpu, Sparkles, Binary, Network } from "lucide-react"
import { cn } from "@/lib/utils"

interface StepProcessingProps {
  onComplete: () => void
}

const PIPELINE_STEPS = [
  {
    label: "Generowanie embeddingów",
    detail: "Kodowanie tekstów modelem encoder...",
    icon: Binary,
    duration: 1800,
  },
  {
    label: "Redukcja wymiarów (UMAP)",
    detail: "Rzutowanie do przestrzeni 2D...",
    icon: Network,
    duration: 1200,
  },
  {
    label: "Klasteryzacja (HDBSCAN)",
    detail: "Wykrywanie naturalnych skupień...",
    icon: Cpu,
    duration: 1400,
  },
  {
    label: "Analiza LLM",
    detail: "Generowanie etykiet i sugestii...",
    icon: Sparkles,
    duration: 1600,
  },
]

export function StepProcessing({ onComplete }: StepProcessingProps) {
  const [currentPipelineStep, setCurrentPipelineStep] = useState(0)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (currentPipelineStep >= PIPELINE_STEPS.length) {
      onComplete()
      return
    }

    const step = PIPELINE_STEPS[currentPipelineStep]
    const intervalMs = step.duration / 100
    let localProgress = 0

    const interval = setInterval(() => {
      localProgress += 1
      const globalBase = (currentPipelineStep / PIPELINE_STEPS.length) * 100
      const globalIncrement =
        (localProgress / 100) * (100 / PIPELINE_STEPS.length)
      setProgress(Math.min(globalBase + globalIncrement, 100))

      if (localProgress >= 100) {
        clearInterval(interval)
        setCurrentPipelineStep((s) => s + 1)
      }
    }, intervalMs)

    return () => clearInterval(interval)
  }, [currentPipelineStep, onComplete])

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-8 py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Analizuję Twoje dokumenty
        </h2>
        <p className="text-sm text-muted-foreground">
          Pipeline ML przetwarza dane. Nie zamykaj okna.
        </p>
      </div>

      <div className="w-full">
        <Progress value={progress} className="h-2" />
        <p className="mt-2 text-right text-xs font-medium text-muted-foreground">
          {Math.round(progress)}%
        </p>
      </div>

      <div className="flex w-full flex-col gap-3">
        {PIPELINE_STEPS.map((step, idx) => {
          const Icon = step.icon
          const isActive = idx === currentPipelineStep
          const isDone = idx < currentPipelineStep

          return (
            <div
              key={step.label}
              className={cn(
                "flex items-center gap-4 rounded-lg border p-4 transition-all",
                isActive && "border-primary/30 bg-primary/[0.03]",
                isDone && "border-border bg-card opacity-60",
                !isActive && !isDone && "border-border bg-card opacity-30"
              )}
            >
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  isActive && "bg-primary text-primary-foreground",
                  isDone && "bg-primary/15 text-primary",
                  !isActive && !isDone && "bg-muted text-muted-foreground"
                )}
              >
                <Icon className={cn("h-4 w-4", isActive && "animate-pulse")} />
              </div>
              <div>
                <p
                  className={cn(
                    "text-sm font-medium",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
              {isDone && (
                <div className="ml-auto text-xs font-medium text-primary">
                  Gotowe
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
