"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { StepIndicator } from "@/components/wizard/step-indicator"
import { StepUpload } from "@/components/wizard/step-upload"
import { StepConfigure } from "@/components/wizard/step-configure"
import { StepProcessing } from "@/components/wizard/step-processing"
import { StepReview } from "@/components/wizard/step-review"
import { StepExplore } from "@/components/wizard/step-explore"
import { JobDashboard } from "@/components/wizard/job-dashboard"
import type {
  WizardStep,
  ClusteringConfig,
  ClusteringResult,
  SavedJob,
} from "@/lib/clustering-types"
import { DEFAULT_CLUSTERING_CONFIG } from "@/lib/clustering-types"
import { updateJob, getJobStatus } from "@/lib/api-client"
import { ArrowLeft, ArrowRight, RotateCcw, Sparkles } from "lucide-react"

const STEP_ORDER: WizardStep[] = [
  "dashboard",
  "upload",
  "configure",
  "processing",
  "review",
  "explore",
]

export default function HomePage() {
  const [currentStep, setCurrentStep] = useState<WizardStep>("dashboard")
  const [texts, setTexts] = useState<string[]>([])
  const [config, setConfig] = useState<ClusteringConfig>({
    ...DEFAULT_CLUSTERING_CONFIG,
  })
  const [clusteringResult, setClusteringResult] =
    useState<ClusteringResult | null>(null)
  const [iterationCount, setIterationCount] = useState(0)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [lastJobId, setLastJobId] = useState<string | null>(null)
  const [jobName, setJobName] = useState("Analiza")

  const currentIndex = STEP_ORDER.indexOf(currentStep)

  const goNext = useCallback(() => {
    if (currentStep === "configure") {
      setPipelineError(null)
      setCurrentStep("processing")
      return
    }
    const nextIdx = currentIndex + 1
    if (nextIdx < STEP_ORDER.length) {
      setCurrentStep(STEP_ORDER[nextIdx])
    }
  }, [currentStep, currentIndex])

  const goBack = useCallback(() => {
    if (currentStep === "upload") {
      // Go back to dashboard instead of nowhere
      setCurrentStep("dashboard")
      return
    }
    const prevIdx = currentIndex - 1
    if (prevIdx >= 0) {
      setCurrentStep(STEP_ORDER[prevIdx])
    }
  }, [currentStep, currentIndex])

  // Dashboard: start new analysis
  const handleNewAnalysis = useCallback(() => {
    setTexts([])
    setConfig({ ...DEFAULT_CLUSTERING_CONFIG })
    setClusteringResult(null)
    setIterationCount(0)
    setPipelineError(null)
    setLastJobId(null)
    setJobName("Analiza")
    setCurrentStep("upload")
  }, [])

  // Dashboard: resume a completed job
  const handleResumeJob = useCallback(async (job: SavedJob) => {
    if (job.status === "completed") {
      // Try to fetch fresh result from backend if available
      try {
        const statusRes = await getJobStatus(job.jobId)
        if (statusRes.status === "completed" && statusRes.result) {
          // Use fresh result from backend
          const freshResult = statusRes.result as ClusteringResult
          setClusteringResult(freshResult)
          setLastJobId(job.jobId)
          setConfig(job.config)
          setJobName(job.name)
          setCurrentStep("review")
          // Update localStorage with fresh result
          updateJob(job.jobId, {
            result: freshResult,
            topicCount: freshResult.topics?.length ?? null,
          })
          return
        }
      } catch {
        // Backend not available or error, fall back to local result
      }
      // Fall back to local result
      if (job.result) {
        setClusteringResult(job.result)
        setLastJobId(job.jobId)
        setConfig(job.config)
        setJobName(job.name)
        setCurrentStep("review")
      }
    }
  }, [])

  // Processing completed
  const handleProcessingComplete = useCallback(
    (result: ClusteringResult, jobId: string) => {
      setClusteringResult(result)
      setLastJobId(jobId)
      setCurrentStep("review")
    },
    []
  )

  // Handle result updates (from merge/split/rename/reclassify operations)
  const handleResultUpdate = useCallback(
    (updatedResult: ClusteringResult) => {
      setClusteringResult(updatedResult)
      // Save updated result to localStorage if we have a jobId
      const jobId = updatedResult.jobId || lastJobId
      if (jobId) {
        updateJob(jobId, {
          result: updatedResult,
          topicCount: updatedResult.topics?.length ?? null,
        })
        // Update lastJobId if it wasn't set
        if (!lastJobId && updatedResult.jobId) {
          setLastJobId(updatedResult.jobId)
        }
      }
    },
    [lastJobId]
  )

  const handleProcessingError = useCallback((message: string) => {
    setPipelineError(message)
    setCurrentStep("configure")
  }, [])

  const handleBackToDashboard = useCallback(() => {
    setCurrentStep("dashboard")
  }, [])

  const handleRecluster = useCallback(() => {
    setIterationCount((c) => c + 1)
    setPipelineError(null)
    if (lastJobId) {
      setConfig((prev) => ({
        ...prev,
        useCachedEmbeddings: true,
        cachedJobId: lastJobId,
      }))
    }
    setCurrentStep("configure")
  }, [lastJobId])

  const handleRestart = useCallback(() => {
    setCurrentStep("dashboard")
  }, [])

  // When texts are loaded, derive a job name from the file
  const handleTextsLoaded = useCallback((loaded: string[]) => {
    setTexts(loaded)
    if (loaded.length > 0) {
      setJobName(`Analiza (${loaded.length} dok.)`)
    }
  }, [])

  const canGoNext =
    (currentStep === "upload" && texts.length > 0) ||
    currentStep === "configure" ||
    currentStep === "review"

  const showNav = !["processing", "dashboard"].includes(currentStep)

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
          <button
            type="button"
            onClick={handleBackToDashboard}
            className="flex items-center gap-3 transition-opacity hover:opacity-80"
          >
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
          </button>
          {currentStep !== "dashboard" && (
            <StepIndicator currentStep={currentStep} />
          )}
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
            <p className="mt-1 text-xs text-destructive/80">{pipelineError}</p>
          </div>
        )}

        {currentStep === "dashboard" && (
          <JobDashboard
            onNewAnalysis={handleNewAnalysis}
            onResumeJob={handleResumeJob}
          />
        )}

        {currentStep === "upload" && (
          <StepUpload
            onTextsLoaded={handleTextsLoaded}
            loadedCount={texts.length}
          />
        )}

        {currentStep === "configure" && (
          <StepConfigure
            config={config}
            onConfigChange={setConfig}
            textCount={texts.length}
            lastJobId={lastJobId}
          />
        )}

        {currentStep === "processing" && (
          <StepProcessing
            texts={texts}
            config={config}
            iteration={iterationCount}
            jobName={jobName}
            onComplete={handleProcessingComplete}
            onError={handleProcessingError}
            onBackToDashboard={handleBackToDashboard}
          />
        )}

        {currentStep === "review" && clusteringResult && (
          <StepReview
            result={clusteringResult}
            onResultUpdate={handleResultUpdate}
          />
        )}

        {currentStep === "explore" && clusteringResult && (
          <StepExplore
            result={clusteringResult}
            onResultUpdate={handleResultUpdate}
          />
        )}
      </main>

      {/* Bottom Navigation */}
      {showNav && (
        <footer className="glass-subtle sticky bottom-0 z-30">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-8">
            <div className="flex items-center gap-2">
              {currentStep === "upload" && (
                <Button
                  variant="ghost"
                  onClick={goBack}
                  className="gap-2 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Panel
                </Button>
              )}
              {currentIndex > 1 &&
                currentStep !== "explore" &&
                currentStep !== "upload" && (
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
                  Panel
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
