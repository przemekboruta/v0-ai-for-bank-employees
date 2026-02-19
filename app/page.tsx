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
import { StepCategories } from "@/components/wizard/step-categories"
import { StepTraining } from "@/components/wizard/step-training"
import { StepClassificationResults } from "@/components/wizard/step-classification-results"
import { PromoteDialog } from "@/components/wizard/promote-dialog"
import { ModelManager } from "@/components/wizard/model-manager"
import type {
  WizardStep,
  WizardPath,
  ClusteringConfig,
  ClusteringResult,
  ClassificationResult,
  CategoryDefinition,
  SavedJob,
} from "@/lib/clustering-types"
import { DEFAULT_CLUSTERING_CONFIG } from "@/lib/clustering-types"
import {
  updateJob,
  getJobStatus,
  createTaxonomy,
  batchClassify,
  addCategory as apiAddCategory,
  updateCategory as apiUpdateCategory,
  deleteCategory as apiDeleteCategory,
  getTaxonomy,
  submitRetrain,
  getTrainingStatus,
} from "@/lib/api-client"
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Sparkles,
  Brain,
  FolderOpen,
  Zap,
  Search,
  FileText,
  ArrowRightCircle,
  HelpCircle,
} from "lucide-react"

export default function HomePage() {
  // Wizard flow
  const [currentStep, setCurrentStep] = useState<WizardStep>("dashboard")
  const [wizardPath, setWizardPath] = useState<WizardPath>("full")

  // Common state
  const [texts, setTexts] = useState<string[]>([])
  const [config, setConfig] = useState<ClusteringConfig>({
    ...DEFAULT_CLUSTERING_CONFIG,
  })
  const [jobName, setJobName] = useState("Analiza")

  // Discovery (clustering) state
  const [clusteringResult, setClusteringResult] = useState<ClusteringResult | null>(null)
  const [iterationCount, setIterationCount] = useState(0)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [lastJobId, setLastJobId] = useState<string | null>(null)

  // Classification state
  const [categories, setCategories] = useState<CategoryDefinition[]>([])
  const [taxonomyId, setTaxonomyId] = useState<string | null>(null)
  const [classificationResult, setClassificationResult] = useState<ClassificationResult | null>(null)
  const [trainedModelId, setTrainedModelId] = useState<string | null>(null)
  const [batchModelId, setBatchModelId] = useState<string | null>(null)

  // Active learning
  const [isRetraining, setIsRetraining] = useState(false)

  // Promote dialog
  const [showPromoteDialog, setShowPromoteDialog] = useState(false)

  // ---- Reset helpers ----

  const resetAll = useCallback(() => {
    setTexts([])
    setConfig({ ...DEFAULT_CLUSTERING_CONFIG })
    setClusteringResult(null)
    setIterationCount(0)
    setPipelineError(null)
    setLastJobId(null)
    setCategories([])
    setTaxonomyId(null)
    setClassificationResult(null)
    setTrainedModelId(null)
    setBatchModelId(null)
    setJobName("Analiza")
  }, [])

  // ---- Dashboard actions ----

  const handleNewAnalysis = useCallback(() => {
    resetAll()
    setWizardPath("full")
    setCurrentStep("upload")
  }, [resetAll])

  const handleNewClassification = useCallback(() => {
    resetAll()
    setWizardPath("classify-only")
    setCurrentStep("upload")
  }, [resetAll])

  const handleBatchClassify = useCallback((modelId: string) => {
    resetAll()
    setWizardPath("batch")
    setBatchModelId(modelId)
    setCurrentStep("upload")
  }, [resetAll])

  const handleResumeJob = useCallback(async (job: SavedJob) => {
    if (job.status === "completed") {
      try {
        const statusRes = await getJobStatus(job.jobId)
        if (statusRes.status === "completed" && statusRes.result) {
          const freshResult = statusRes.result as ClusteringResult
          setClusteringResult(freshResult)
          setLastJobId(job.jobId)
          setConfig(job.config)
          setJobName(job.name)
          setWizardPath("full")
          setCurrentStep("review")
          updateJob(job.jobId, {
            result: freshResult,
            topicCount: freshResult.topics?.length ?? null,
          })
          return
        }
      } catch {
        // Fall back to local result
      }
      if (job.result) {
        setClusteringResult(job.result)
        setLastJobId(job.jobId)
        setConfig(job.config)
        setJobName(job.name)
        setWizardPath("full")
        setCurrentStep("review")
      }
    }
  }, [])

  // ---- Processing callbacks ----

  const handleProcessingComplete = useCallback(
    (result: ClusteringResult, jobId: string) => {
      setClusteringResult(result)
      setLastJobId(jobId)
      setCurrentStep("review")
    },
    []
  )

  const handleResultUpdate = useCallback(
    (updatedResult: ClusteringResult) => {
      setClusteringResult(updatedResult)
      const jobId = updatedResult.jobId || lastJobId
      if (jobId) {
        updateJob(jobId, {
          result: updatedResult,
          topicCount: updatedResult.topics?.length ?? null,
        })
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

  // ---- Classification callbacks ----

  const handleTrainingComplete = useCallback(
    (result: ClassificationResult, modelId: string, _jobId: string) => {
      setClassificationResult(result)
      setTrainedModelId(modelId)
      if (result.documents.length > 0) {
        setCurrentStep("classification-results")
      }
    },
    []
  )

  const handleTrainingError = useCallback((message: string) => {
    setPipelineError(message)
  }, [])

  // ---- Active Learning: Retrain ----

  const handleRetrain = useCallback(
    async (corrections: Array<{ text: string; correctedCategoryName: string }>) => {
      if (!trainedModelId || corrections.length === 0) return
      setIsRetraining(true)
      setPipelineError(null)
      try {
        const { jobId } = await submitRetrain({
          modelId: trainedModelId,
          corrections,
          texts: texts.length > 0 ? texts : undefined,
        })

        // Poll for completion
        const pollInterval = setInterval(async () => {
          try {
            const status = await getTrainingStatus(jobId)
            if (status.status === "completed") {
              clearInterval(pollInterval)
              setIsRetraining(false)
              if (status.result && status.modelId) {
                setClassificationResult(status.result)
                setTrainedModelId(status.modelId)
              }
            } else if (status.status === "failed") {
              clearInterval(pollInterval)
              setIsRetraining(false)
              setPipelineError(status.error || "Dotrenowanie modelu zakonczylo sie bledem")
            }
          } catch {
            clearInterval(pollInterval)
            setIsRetraining(false)
            setPipelineError("Utracono polaczenie z backendem podczas dotrenowywania")
          }
        }, 2000)
      } catch (error) {
        setIsRetraining(false)
        setPipelineError(
          error instanceof Error ? error.message : "Nie udalo sie uruchomic dotrenowywania"
        )
      }
    },
    [trainedModelId, texts]
  )

  // ---- Promote flow ----

  const handlePromoteOpen = useCallback(() => {
    setShowPromoteDialog(true)
  }, [])

  const handlePromoted = useCallback(
    (newTaxonomyId: string) => {
      setTaxonomyId(newTaxonomyId)
      // Fetch categories from the newly created taxonomy
      // The promote dialog already imported clusters, so we need to refresh
      getTaxonomy(newTaxonomyId).then((tax) => {
        setCategories(tax.categories || [])
        setCurrentStep("categories")
      })
    },
    []
  )

  // ---- Batch classify with saved model ----

  const handleBatchUploadDone = useCallback(async () => {
    if (!batchModelId || texts.length === 0) return
    try {
      const result = await batchClassify(texts, batchModelId)
      setClassificationResult(result)
      setTrainedModelId(batchModelId)
      setCurrentStep("classification-results")
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : "Blad klasyfikacji batch")
    }
  }, [batchModelId, texts])

  // ---- Navigation ----

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

  const handleTextsLoaded = useCallback((loaded: string[]) => {
    setTexts(loaded)
    if (loaded.length > 0) {
      setJobName(`Analiza (${loaded.length} dok.)`)
    }
  }, [])

  // Handle "classify new data" from results
  const handleClassifyNew = useCallback(() => {
    setTexts([])
    setClassificationResult(null)
    setCurrentStep("upload")
  }, [])

  // Navigate to categories directly (classify-only path)
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null)

  const handleGoToCategories = useCallback(async () => {
    // Create taxonomy if needed
    if (!taxonomyId) {
      try {
        const tax = await createTaxonomy("Kategorie")
        setTaxonomyId(tax.taxonomyId)
        setTaxonomyError(null)
      } catch {
        // Continue without backend taxonomy — templates won't be available
        setTaxonomyError("Brak polaczenia z backendem — szablony kategorii sa niedostepne. Mozesz dodawac kategorie recznie.")
      }
    }
    setCurrentStep("categories")
  }, [taxonomyId])

  // Sync local categories to backend taxonomy (before training)
  const syncCategoriesToBackend = useCallback(async () => {
    if (!taxonomyId) return
    try {
      const tax = await getTaxonomy(taxonomyId)
      const remoteCats = tax.categories || []
      const remoteIds = new Set(remoteCats.map((c: CategoryDefinition) => c.id))
      const localIds = new Set(categories.map((c) => c.id))

      // Add new categories
      for (const cat of categories) {
        if (!remoteIds.has(cat.id)) {
          await apiAddCategory(taxonomyId, cat.name, cat.examples, cat.description)
        }
      }

      // Update existing categories
      for (const cat of categories) {
        if (remoteIds.has(cat.id)) {
          await apiUpdateCategory(taxonomyId, cat.id, {
            name: cat.name,
            examples: cat.examples,
            description: cat.description,
          })
        }
      }

      // Delete removed categories
      for (const remote of remoteCats) {
        if (!localIds.has(remote.id)) {
          await apiDeleteCategory(taxonomyId, remote.id)
        }
      }
    } catch (error) {
      console.error("Failed to sync categories to backend:", error)
    }
  }, [taxonomyId, categories])

  // Step-specific navigation
  const getNextStep = useCallback((): WizardStep | null => {
    if (wizardPath === "classify-only") {
      const steps: WizardStep[] = ["upload", "categories", "training", "classification-results"]
      const idx = steps.indexOf(currentStep)
      return idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : null
    }
    if (wizardPath === "batch") {
      if (currentStep === "upload") return "classification-results"
      return null
    }
    // Full path
    const steps: WizardStep[] = [
      "upload", "configure", "processing", "review", "explore",
      "categories", "training", "classification-results",
    ]
    const idx = steps.indexOf(currentStep)
    return idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : null
  }, [currentStep, wizardPath])

  const goNext = useCallback(() => {
    if (currentStep === "configure") {
      setPipelineError(null)
      setCurrentStep("processing")
      return
    }
    if (currentStep === "upload" && wizardPath === "classify-only") {
      handleGoToCategories()
      return
    }
    if (currentStep === "upload" && wizardPath === "batch") {
      handleBatchUploadDone()
      return
    }
    if (currentStep === "explore") {
      handleGoToCategories()
      return
    }
    if (currentStep === "categories") {
      // Sync categories to backend taxonomy before training
      if (taxonomyId) {
        syncCategoriesToBackend().catch(() => {
          // Continue even if sync fails — training uses local categories as fallback
        })
      }
      setCurrentStep("training")
      return
    }
    const next = getNextStep()
    if (next) setCurrentStep(next)
  }, [currentStep, wizardPath, getNextStep, handleGoToCategories, handleBatchUploadDone])

  const goBack = useCallback(() => {
    if (currentStep === "upload") {
      setCurrentStep("dashboard")
      return
    }
    if (wizardPath === "classify-only") {
      const steps: WizardStep[] = ["upload", "categories", "training", "classification-results"]
      const idx = steps.indexOf(currentStep)
      if (idx > 0) setCurrentStep(steps[idx - 1])
      return
    }
    if (currentStep === "categories" && clusteringResult) {
      setCurrentStep("review")
      return
    }
    if (currentStep === "categories") {
      setCurrentStep("upload")
      return
    }
    if (currentStep === "training") {
      setCurrentStep("categories")
      return
    }
    if (currentStep === "classification-results") {
      setCurrentStep("training")
      return
    }
    // Discovery flow
    const discoverySteps: WizardStep[] = ["upload", "configure", "processing", "review", "explore"]
    const idx = discoverySteps.indexOf(currentStep)
    if (idx > 0) setCurrentStep(discoverySteps[idx - 1])
  }, [currentStep, wizardPath, clusteringResult])

  const canGoNext =
    (currentStep === "upload" && texts.length > 0) ||
    currentStep === "configure" ||
    currentStep === "review" ||
    currentStep === "explore" ||
    (currentStep === "categories" && categories.length >= 2)

  const showNav = !["processing", "dashboard", "training"].includes(currentStep)

  const nextLabel = (() => {
    if (currentStep === "configure") return "Analizuj"
    if (currentStep === "upload" && wizardPath === "classify-only") return "Kategorie"
    if (currentStep === "upload" && wizardPath === "batch") return "Klasyfikuj"
    if (currentStep === "review") return "Eksploruj"
    if (currentStep === "explore") return "Kategorie"
    if (currentStep === "categories") return "Trenuj"
    return "Dalej"
  })()

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
                Odkrywanie tematow i klasyfikacja dokumentow
              </p>
            </div>
          </button>
          {currentStep !== "dashboard" && (
            <StepIndicator currentStep={currentStep} wizardPath={wizardPath} />
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">
        {/* Pipeline error banner */}
        {pipelineError && ["configure", "categories", "training", "classification-results"].includes(currentStep) && (
          <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/[0.08] px-5 py-4">
            <p className="text-sm font-medium text-destructive">
              Blad pipeline&apos;u
            </p>
            <p className="mt-1 text-xs text-destructive/80">{pipelineError}</p>
          </div>
        )}

        {currentStep === "dashboard" && (
          <div className="flex flex-col gap-8">
            {/* Welcome hero */}
            <div className="flex flex-col items-center gap-3 text-center pt-4 pb-2">
              <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
                Co chcesz dzisiaj zrobic?
              </h2>
              <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
                Wybierz sciezke dopasowana do Twojej sytuacji. Kazda poprowadzi Cie krok po kroku — nie musisz znac sie na ML.
              </p>
            </div>

            {/* Path cards */}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {/* Full analysis */}
              <button
                type="button"
                onClick={handleNewAnalysis}
                className="glass-interactive group flex flex-col gap-4 rounded-2xl p-6 text-left transition-all hover:scale-[1.02]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/20 glow-primary">
                    <Search className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-display text-base font-semibold text-foreground">
                    Odkryj tematy
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Nie wiem, jakie kategorie sa w moich danych. System automatycznie znajdzie grupy tematyczne, a ja wybierze te przydatne.
                </p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">Discovery AI</span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">Kategorie</span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">Klasyfikator</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Rozpocznij
                  <ArrowRightCircle className="h-3.5 w-3.5" />
                </div>
              </button>

              {/* Classify with template/manual */}
              <button
                type="button"
                onClick={handleNewClassification}
                className="glass-interactive group flex flex-col gap-4 rounded-2xl p-6 text-left transition-all hover:scale-[1.02]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-chart-2/20">
                    <FolderOpen className="h-5 w-5 text-chart-2" />
                  </div>
                  <h3 className="font-display text-base font-semibold text-foreground">
                    Klasyfikuj z szablonu
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Mam gotowe kategorie (np. typy reklamacji) lub chce uzyc szablonu. Wystarczy kilka przykladow na kategorie.
                </p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">Szablony</span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">Few-shot</span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">Klasyfikator</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-chart-2 opacity-0 transition-opacity group-hover:opacity-100">
                  Rozpocznij
                  <ArrowRightCircle className="h-3.5 w-3.5" />
                </div>
              </button>

              {/* Batch with saved model */}
              <button
                type="button"
                onClick={() => {
                  document.getElementById("model-manager-section")?.scrollIntoView({ behavior: "smooth" })
                }}
                className="glass-interactive group flex flex-col gap-4 rounded-2xl p-6 text-left transition-all hover:scale-[1.02]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-chart-4/20">
                    <Zap className="h-5 w-5 text-chart-4" />
                  </div>
                  <h3 className="font-display text-base font-semibold text-foreground">
                    Uzyj istniejacego modelu
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Mam juz wytrenowany model i chce sklasyfikowac nowe dane. Bez ponownego treningu — natychmiastowe wyniki.
                </p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">Gotowy model</span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">Batch</span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">Szybko</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-chart-4 opacity-0 transition-opacity group-hover:opacity-100">
                  Wybierz model ponizej
                  <ArrowRightCircle className="h-3.5 w-3.5" />
                </div>
              </button>
            </div>

            {/* Model manager */}
            <div id="model-manager-section">
              <ModelManager onUseModel={handleBatchClassify} />
            </div>

            {/* Job dashboard */}
            <JobDashboard
              onNewAnalysis={handleNewAnalysis}
              onResumeJob={handleResumeJob}
            />
          </div>
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
            onPromoteToCategoryies={handlePromoteOpen}
          />
        )}

        {currentStep === "explore" && clusteringResult && (
          <StepExplore
            result={clusteringResult}
            onResultUpdate={handleResultUpdate}
          />
        )}

        {currentStep === "categories" && (
          <StepCategories
            categories={categories}
            onCategoriesChange={setCategories}
            taxonomyId={taxonomyId || undefined}
            clusteringResult={clusteringResult}
            onPromoteFromClustering={
              clusteringResult ? handlePromoteOpen : undefined
            }
            backendError={taxonomyError || undefined}
          />
        )}

        {currentStep === "training" && (
          <StepTraining
            categories={categories}
            texts={texts}
            taxonomyId={taxonomyId || undefined}
            onTrainingComplete={handleTrainingComplete}
            onError={handleTrainingError}
          />
        )}

        {currentStep === "classification-results" && classificationResult && (
          <StepClassificationResults
            result={classificationResult}
            modelId={trainedModelId || ""}
            onClassifyNew={handleClassifyNew}
            onRetrain={trainedModelId ? handleRetrain : undefined}
            isRetraining={isRetraining}
            onSaveModel={trainedModelId ? () => {
              setCurrentStep("dashboard")
            } : undefined}
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
              {currentStep !== "upload" &&
                currentStep !== "classification-results" && (
                  <Button
                    variant="ghost"
                    onClick={goBack}
                    className="gap-2 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Wstecz
                  </Button>
                )}
              {currentStep === "classification-results" && (
                <Button
                  variant="ghost"
                  onClick={handleBackToDashboard}
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
                  {nextLabel}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </footer>
      )}

      {/* Promote Dialog */}
      {clusteringResult && (
        <PromoteDialog
          open={showPromoteDialog}
          onOpenChange={setShowPromoteDialog}
          result={clusteringResult}
          onPromoted={handlePromoted}
        />
      )}
    </div>
  )
}
