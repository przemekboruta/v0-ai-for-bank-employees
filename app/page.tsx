"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { StepIndicator } from "@/components/wizard/step-indicator"
import { StepUpload } from "@/components/wizard/step-upload"
import { StepConfigure } from "@/components/wizard/step-configure"
import { StepProcessing } from "@/components/wizard/step-processing"
import { StepReview } from "@/components/wizard/step-review"
import { StepExplore } from "@/components/wizard/step-explore"
import type {
  WizardStep,
  Granularity,
  ClusteringResult,
} from "@/lib/clustering-types"
import { runClustering } from "@/lib/api-client"
import { ArrowLeft, ArrowRight, RotateCcw, Sparkles } from "lucide-react"

const STEP_ORDER: WizardStep[] = [
  "upload",
  "configure",
  "processing",
  "review",
  "explore",
]

export default function HomePage() {
  const [currentStep, setCurrentStep] = useState<WizardStep>("upload")
  const [texts, setTexts] = useState<string[]>([])
  const [granularity, setGranularity] = useState<Granularity>("medium")
  const [clusteringResult, setClusteringResult] =
    useState<ClusteringResult | null>(null)
  const [iterationCount, setIterationCount] = useState(0)
  const [pipelineError, setPipelineError] = useState<string | null>(null)

  const currentIndex = STEP_ORDER.indexOf(currentStep)

  const goNext = useCallback(() => {
    if (currentStep === "configure") {
      setCurrentStep("processing")
      return
    }
    const nextIdx = currentIndex + 1
    if (nextIdx < STEP_ORDER.length) {
      setCurrentStep(STEP_ORDER[nextIdx])
    }
  }, [currentStep, currentIndex])

  const goBack = useCallback(() => {
    const prevIdx = currentIndex - 1
    if (prevIdx >= 0) {
      setCurrentStep(STEP_ORDER[prevIdx])
    }
  }, [currentIndex])

  const handleProcessingComplete = useCallback(async () => {
    try {
      setPipelineError(null)
      const result = await runClustering(texts, granularity, iterationCount)
      setClusteringResult(result)
      setCurrentStep("review")
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Nieznany blad pipeline'u"
      setPipelineError(message)
      setCurrentStep("configure")
    }
  }, [texts, granularity, iterationCount])

  const handleRecluster = useCallback(() => {
    setIterationCount((c) => c + 1)
    setPipelineError(null)
    setCurrentStep("processing")
  }, [])

  const handleRestart = useCallback(() => {
    setCurrentStep("upload")
    setTexts([])
    setGranularity("medium")
    setClusteringResult(null)
    setIterationCount(0)
    setPipelineError(null)
  }, [])

  const canGoNext =
    (currentStep === "upload" && texts.length > 0) ||
    currentStep === "configure" ||
    currentStep === "review"

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Mesh gradient background */}
      <div className="mesh-gradient pointer-events-none fixed inset-0 z-0" />

      {/* Floating ambient orbs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/[0.07] blur-[100px]" />
        <div className="absolute -bottom-48 -right-48 h-[500px] w-[500px] rounded-full bg-accent/[0.05] blur-[120px]" />
        <div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-chart-4/[0.04] blur-[80px]" />
      </div>

      {/* Header */}
      <header className="glass-subtle sticky top-0 z-30">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 glow-primary">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-sm font-bold tracking-tight text-foreground">
                Topic Discovery Hub
              </h1>
              <p className="hidden text-[11px] text-muted-foreground sm:block">
                Automatyczne wykrywanie kategorii tematycznych
              </p>
            </div>
          </div>
          <StepIndicator currentStep={currentStep} />
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">
        {/* Pipeline error banner */}
        {pipelineError && currentStep === "configure" && (
          <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/[0.08] px-5 py-4">
            <p className="text-sm font-medium text-destructive">
              Blad pipeline&apos;u ML
            </p>
            <p className="mt-1 text-xs text-destructive/80">
              {pipelineError}
            </p>
          </div>
        )}

        {currentStep === "upload" && (
          <StepUpload onTextsLoaded={setTexts} loadedCount={texts.length} />
        )}

        {currentStep === "configure" && (
          <StepConfigure
            granularity={granularity}
            onGranularityChange={setGranularity}
            textCount={texts.length}
          />
        )}

        {currentStep === "processing" && (
          <StepProcessing onComplete={handleProcessingComplete} />
        )}

        {currentStep === "review" && clusteringResult && (
          <StepReview
            result={clusteringResult}
            onResultUpdate={setClusteringResult}
          />
        )}

        {currentStep === "explore" && clusteringResult && (
          <StepExplore
            result={clusteringResult}
            onResultUpdate={setClusteringResult}
          />
        )}
      </main>

      {/* Bottom Navigation */}
      {currentStep !== "processing" && (
        <footer className="glass-subtle sticky bottom-0 z-30">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-8">
            <div className="flex items-center gap-2">
              {currentIndex > 0 && currentStep !== "explore" && (
                <Button
                  variant="ghost"
                  onClick={goBack}
                  className="gap-2 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Wstecz
                </Button>
              )}
              {currentStep === "explore" && (
                <Button
                  variant="ghost"
                  onClick={handleRestart}
                  className="gap-2 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                >
                  <RotateCcw className="h-4 w-4" />
                  Nowa analiza
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {(currentStep === "review" || currentStep === "explore") && (
                <Button
                  variant="outline"
                  onClick={handleRecluster}
                  className="gap-2 border-white/[0.1] bg-transparent text-muted-foreground hover:border-white/[0.2] hover:text-foreground hover:bg-white/[0.04]"
                >
                  <RotateCcw className="h-4 w-4" />
                  Klasteryzuj ponownie
                </Button>
              )}
              {canGoNext && (
                <Button
                  onClick={goNext}
                  className="gap-2 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary"
                >
                  {currentStep === "configure" ? "Analizuj" : "Dalej"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
