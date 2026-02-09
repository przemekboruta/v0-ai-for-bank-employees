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
import { generateMockClustering } from "@/lib/mock-clustering"
import { ArrowLeft, ArrowRight, RotateCcw, Layers3 } from "lucide-react"

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

  const handleProcessingComplete = useCallback(() => {
    const result = generateMockClustering(
      texts,
      granularity,
      42 + iterationCount
    )
    setClusteringResult(result)
    setCurrentStep("review")
  }, [texts, granularity, iterationCount])

  const handleRecluster = useCallback(() => {
    setIterationCount((c) => c + 1)
    setCurrentStep("processing")
  }, [])

  const handleRestart = useCallback(() => {
    setCurrentStep("upload")
    setTexts([])
    setGranularity("medium")
    setClusteringResult(null)
    setIterationCount(0)
  }, [])

  const canGoNext =
    (currentStep === "upload" && texts.length > 0) ||
    currentStep === "configure" ||
    currentStep === "review"

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Layers3 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-display text-base font-bold tracking-tight text-foreground">
                Topic Discovery Hub
              </h1>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Automatyczne wykrywanie kategorii tematycznych
              </p>
            </div>
          </div>
          <StepIndicator currentStep={currentStep} />
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">
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
          <StepExplore result={clusteringResult} />
        )}
      </main>

      {/* Bottom Navigation */}
      {currentStep !== "processing" && (
        <footer className="sticky bottom-0 border-t bg-card/80 backdrop-blur-sm">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-8">
            <div className="flex items-center gap-2">
              {currentIndex > 0 && currentStep !== "explore" && (
                <Button variant="ghost" onClick={goBack} className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Wstecz
                </Button>
              )}
              {currentStep === "explore" && (
                <Button
                  variant="ghost"
                  onClick={handleRestart}
                  className="gap-2"
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
                  className="gap-2 bg-transparent"
                >
                  <RotateCcw className="h-4 w-4" />
                  Klasteryzuj ponownie
                </Button>
              )}
              {canGoNext && (
                <Button onClick={goNext} className="gap-2">
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
