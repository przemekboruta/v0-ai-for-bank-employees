"use client"

import React from "react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { SavedJob, ClusteringResult } from "@/lib/clustering-types"
import { DEFAULT_CLUSTERING_CONFIG } from "@/lib/clustering-types"
import {
  listJobs,
  deleteJob,
  getJobStatus as fetchJobStatus,
  updateJob,
  getJob,
  saveJob,
  listBackendJobs,
} from "@/lib/api-client"
import { generateMockClustering } from "@/lib/mock-clustering"
import {
  Plus,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  ArrowRight,
  RefreshCw,
  History,
  Sparkles,
  Play,
  Server,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface JobDashboardProps {
  onNewAnalysis: () => void
  onResumeJob: (job: SavedJob) => void
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ElementType; bgClass: string }
> = {
  queued: {
    label: "W kolejce",
    color: "text-muted-foreground",
    icon: Clock,
    bgClass: "bg-white/[0.06]",
  },
  embedding: {
    label: "Embeddingi",
    color: "text-chart-3",
    icon: Loader2,
    bgClass: "bg-chart-3/10",
  },
  reducing: {
    label: "Redukcja",
    color: "text-chart-5",
    icon: Loader2,
    bgClass: "bg-chart-5/10",
  },
  clustering: {
    label: "Klasteryzacja",
    color: "text-primary",
    icon: Loader2,
    bgClass: "bg-primary/10",
  },
  labeling: {
    label: "LLM",
    color: "text-accent",
    icon: Sparkles,
    bgClass: "bg-accent/10",
  },
  completed: {
    label: "Zakonczono",
    color: "text-accent",
    icon: CheckCircle2,
    bgClass: "bg-accent/10",
  },
  failed: {
    label: "Blad",
    color: "text-destructive",
    icon: AlertTriangle,
    bgClass: "bg-destructive/10",
  },
  interrupted: {
    label: "Przerwano",
    color: "text-chart-3",
    icon: Clock,
    bgClass: "bg-chart-3/10",
  },
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  if (Number.isNaN(then)) return ""
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "przed chwila"
  if (diffMin < 60) return `${diffMin} min temu`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH} godz. temu`
  const diffD = Math.floor(diffH / 24)
  return `${diffD} dn. temu`
}

function isMockJob(jobId: string): boolean {
  return jobId.startsWith("mock-")
}

/**
 * Detect stale mock jobs that were abandoned (user left StepProcessing).
 * Mock jobs have no backend worker, so if they're still "in progress"
 * and haven't been updated recently, mark them interrupted.
 */
function fixStaleMockJobs(): boolean {
  let changed = false
  const jobs = listJobs()
  for (const job of jobs) {
    if (
      isMockJob(job.jobId) &&
      !["completed", "failed", "interrupted"].includes(job.status)
    ) {
      const lastUpdate = new Date(job.updatedAt).getTime()
      if (Date.now() - lastUpdate > 10_000) {
        updateJob(job.jobId, { status: "interrupted" as SavedJob["status"] })
        changed = true
      }
    }
  }
  return changed
}

export function JobDashboard({ onNewAnalysis, onResumeJob }: JobDashboardProps) {
  const [jobs, setJobs] = useState<SavedJob[]>([])
  const [resumingId, setResumingId] = useState<string | null>(null)
  const [isBackendConnected, setIsBackendConnected] = useState(false)

  // Merge local sessionStorage jobs with backend Redis jobs
  const refreshJobs = useCallback(async () => {
    // 1. Local jobs
    const localJobs = listJobs()

    // 2. Try fetching backend jobs
    let backendJobs: SavedJob[] = []
    try {
      const rawJobs = await listBackendJobs()
      if (rawJobs.length > 0) {
        setIsBackendConnected(true)
        backendJobs = rawJobs.map((bj) => ({
          jobId: bj.jobId,
          name: `Analiza (${bj.textCount} dok.)`,
          status: bj.status as SavedJob["status"],
          progress: typeof bj.progress === "number" ? bj.progress : 0,
          textCount: bj.textCount ?? 0,
          topicCount: null,
          config: {
            ...DEFAULT_CLUSTERING_CONFIG,
            ...(typeof bj.config === "object" ? bj.config : {}),
          },
          createdAt: bj.createdAt ?? new Date().toISOString(),
          updatedAt: bj.updatedAt ?? new Date().toISOString(),
          result: null,
          error: bj.error,
        }))
      }
    } catch {
      // Backend not available, just use local jobs
    }

    // 3. Merge: backend jobs override local jobs with same ID,
    //    but keep local result/topicCount if local has them
    const merged = new Map<string, SavedJob>()
    for (const job of localJobs) {
      merged.set(job.jobId, job)
    }
    for (const bj of backendJobs) {
      const existing = merged.get(bj.jobId)
      if (existing) {
        // Keep local result if backend hasn't returned one yet
        merged.set(bj.jobId, {
          ...bj,
          name: existing.name || bj.name,
          result: existing.result,
          topicCount: existing.topicCount ?? bj.topicCount,
        })
      } else {
        merged.set(bj.jobId, bj)
      }
    }

    // Sort newest first
    const all = Array.from(merged.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    setJobs(all)
  }, [])

  // Initial load + fix stale
  useEffect(() => {
    fixStaleMockJobs()
    refreshJobs()
  }, [refreshJobs])

  // Poll in-progress jobs
  useEffect(() => {
    const inProgress = jobs.filter(
      (j) => !["completed", "failed", "interrupted"].includes(j.status)
    )
    if (inProgress.length === 0) return

    const interval = setInterval(async () => {
      let changed = false
      for (const job of inProgress) {
        if (isMockJob(job.jobId)) {
          // Mock jobs: check local store, mark stale as interrupted
          const latest = getJob(job.jobId)
          if (latest && latest.status !== job.status) changed = true
          if (
            latest &&
            !["completed", "failed", "interrupted"].includes(latest.status)
          ) {
            const lastUpdate = new Date(latest.updatedAt).getTime()
            if (Date.now() - lastUpdate > 10_000) {
              updateJob(job.jobId, { status: "interrupted" as SavedJob["status"] })
              changed = true
            }
          }
          continue
        }
        // Backend jobs: poll via API
        try {
          const statusRes = await fetchJobStatus(job.jobId)
          const newStatus = statusRes.status as SavedJob["status"]
          if (newStatus !== job.status || statusRes.progress !== job.progress) {
            const result = (statusRes.result as ClusteringResult | undefined) ?? null
            updateJob(job.jobId, {
              status: newStatus,
              progress: statusRes.progress ?? 0,
              topicCount: result?.topics?.length ?? job.topicCount,
              result: result ?? job.result,
              error: statusRes.error,
            })
            // Also save locally so result is available for resume
            if (newStatus === "completed" && result) {
              saveJob({
                ...job,
                status: "completed",
                progress: 100,
                topicCount: result.topics?.length ?? 0,
                result,
                updatedAt: new Date().toISOString(),
              })
            }
            changed = true
          }
        } catch {
          // Network error, skip
        }
      }
      if (changed) refreshJobs()
    }, 3000)

    return () => clearInterval(interval)
  }, [jobs, refreshJobs])

  const handleDelete = useCallback(
    (jobId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      deleteJob(jobId)
      refreshJobs()
    },
    [refreshJobs]
  )

  // Resume interrupted MOCK jobs by generating result locally
  const handleResumeInterrupted = useCallback(
    async (job: SavedJob) => {
      setResumingId(job.jobId)
      try {
        updateJob(job.jobId, { status: "clustering" as SavedJob["status"], progress: 50 })
        await refreshJobs()

        // Generate result locally -- never call API for mock jobs
        const result = generateMockClustering(
          Array.from({ length: job.textCount }, (_, i) => `Dokument ${i + 1}`),
          job.config.granularity,
          Date.now()
        )
        result.jobId = job.jobId

        updateJob(job.jobId, {
          status: "completed",
          progress: 100,
          result,
          topicCount: result.topics.length,
        })
        await refreshJobs()

        const updated = getJob(job.jobId)
        if (updated) onResumeJob(updated)
      } catch {
        updateJob(job.jobId, {
          status: "failed" as SavedJob["status"],
          error: "Nie udalo sie wznowic przetwarzania",
        })
        refreshJobs()
      } finally {
        setResumingId(null)
      }
    },
    [refreshJobs, onResumeJob]
  )

  const completedJobs = jobs.filter((j) => j.status === "completed")
  const activeJobs = jobs.filter(
    (j) => !["completed", "failed", "interrupted"].includes(j.status)
  )
  const interruptedJobs = jobs.filter((j) => j.status === "interrupted")
  const failedJobs = jobs.filter((j) => j.status === "failed")

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Twoje analizy
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Wyslij nowe zlecenie lub wroc do wczesniejszych przetworzen.
            {isBackendConnected && (
              <span className="ml-2 inline-flex items-center gap-1 text-accent">
                <Server className="inline h-3 w-3" />
                Backend polaczony
              </span>
            )}
          </p>
        </div>
        <Button
          onClick={onNewAnalysis}
          className="gap-2 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary"
        >
          <Plus className="h-4 w-4" />
          Nowa analiza
        </Button>
      </div>

      {/* Active jobs */}
      {activeJobs.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              W trakcie ({activeJobs.length})
            </h3>
          </div>
          <div className="flex flex-col gap-2">
            {activeJobs.map((job) => {
              const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.queued
              const StatusIcon = cfg.icon
              return (
                <div
                  key={job.jobId}
                  className="glass-interactive group flex items-center gap-4 rounded-2xl p-5 cursor-default"
                >
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      cfg.bgClass
                    )}
                  >
                    <StatusIcon className={cn("h-4 w-4", cfg.color, "animate-spin")} />
                  </div>
                  <div className="flex flex-1 flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {job.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn("shrink-0 text-[10px] border-0", cfg.bgClass, cfg.color)}
                      >
                        {cfg.label}
                      </Badge>
                      {!isMockJob(job.jobId) && (
                        <Badge variant="secondary" className="shrink-0 text-[10px] border-0 bg-accent/10 text-accent">
                          <Server className="mr-0.5 h-2.5 w-2.5" />
                          Serwer
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{job.textCount} dok.</span>
                      <span>{job.config?.algorithm?.toUpperCase() ?? "HDBSCAN"}</span>
                      <span>{timeAgo(job.createdAt)}</span>
                    </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all duration-700"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs font-medium text-primary">
                    {Math.round(job.progress)}%
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Interrupted jobs */}
      {interruptedJobs.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-chart-3" />
            <h3 className="text-sm font-semibold text-foreground">
              Przerwane ({interruptedJobs.length})
            </h3>
          </div>
          <div className="flex flex-col gap-2">
            {interruptedJobs.map((job) => (
              <div
                key={job.jobId}
                className="glass-interactive group flex items-center gap-4 rounded-2xl p-5"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-chart-3/10">
                  <Clock className="h-4 w-4 text-chart-3" />
                </div>
                <div className="flex flex-1 flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {job.name}
                    </span>
                    <Badge
                      variant="secondary"
                      className="shrink-0 text-[10px] border-0 bg-chart-3/10 text-chart-3"
                    >
                      Przerwano
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{job.textCount} dok.</span>
                    <span>{job.config?.algorithm?.toUpperCase() ?? "HDBSCAN"}</span>
                    <span>{timeAgo(job.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={resumingId === job.jobId}
                    onClick={() => handleResumeInterrupted(job)}
                    className="gap-1.5 text-xs text-chart-3 hover:text-foreground hover:bg-white/[0.06]"
                  >
                    {resumingId === job.jobId ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    Wznow
                  </Button>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => handleDelete(job.jobId, e)}
                    aria-label="Usun"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Completed jobs */}
      {completedJobs.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">
              Zakonczone ({completedJobs.length})
            </h3>
          </div>
          <ScrollArea className={completedJobs.length > 5 ? "h-[420px]" : ""}>
            <div className="flex flex-col gap-2 pr-2">
              {completedJobs.map((job) => (
                <button
                  type="button"
                  key={job.jobId}
                  onClick={() => onResumeJob(job)}
                  className="glass-interactive group flex items-center gap-4 rounded-2xl p-5 text-left transition-all hover:border-primary/20"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                    <CheckCircle2 className="h-4 w-4 text-accent" />
                  </div>
                  <div className="flex flex-1 flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {job.name}
                      </span>
                      {job.topicCount != null && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 bg-white/[0.06] text-[10px] text-muted-foreground border-0"
                        >
                          {job.topicCount} kategorii
                        </Badge>
                      )}
                      {!isMockJob(job.jobId) && (
                        <Badge variant="secondary" className="shrink-0 text-[10px] border-0 bg-accent/10 text-accent">
                          <Server className="mr-0.5 h-2.5 w-2.5" />
                          Serwer
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{job.textCount} dok.</span>
                      <span>{job.config?.algorithm?.toUpperCase() ?? "HDBSCAN"}</span>
                      {job.config?.dimReduction && job.config.dimReduction !== "none" && (
                        <span>{job.config.dimReduction.toUpperCase()}</span>
                      )}
                      <span>{timeAgo(job.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      role="button"
                      tabIndex={0}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      onClick={(e) => handleDelete(job.jobId, e)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          handleDelete(job.jobId, e as unknown as React.MouseEvent)
                      }}
                      aria-label="Usun"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-all group-hover:text-primary group-hover:translate-x-0.5" />
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </section>
      )}

      {/* Failed jobs */}
      {failedJobs.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold text-foreground">
              Nieudane ({failedJobs.length})
            </h3>
          </div>
          <div className="flex flex-col gap-2">
            {failedJobs.map((job) => (
              <div
                key={job.jobId}
                className="glass flex items-center gap-4 rounded-2xl border-destructive/10 p-5"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </div>
                <div className="flex flex-1 flex-col gap-1 min-w-0">
                  <span className="text-sm font-medium text-foreground truncate">
                    {job.name}
                  </span>
                  <p className="text-xs text-destructive/80 truncate">
                    {job.error ?? "Nieznany blad"}
                  </p>
                  <span className="text-xs text-muted-foreground">{timeAgo(job.updatedAt)}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDelete(job.jobId, e)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Usun"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {jobs.length === 0 && (
        <div className="glass flex flex-col items-center gap-5 rounded-2xl px-8 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <History className="h-7 w-7 text-primary/60" />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-foreground">Brak przetworzen</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Rozpocznij nowa analize, aby wykryc tematy w swoich dokumentach. Przetwarzania sa
              kolejkowane i mozesz do nich wracac w dowolnym momencie.
            </p>
          </div>
          <Button
            onClick={onNewAnalysis}
            className="gap-2 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary"
          >
            <Plus className="h-4 w-4" />
            Rozpocznij analize
          </Button>
        </div>
      )}

      {/* Refresh */}
      {jobs.length > 0 && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refreshJobs()}
            className="gap-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
          >
            <RefreshCw className="h-3 w-3" />
            Odswiez
          </Button>
        </div>
      )}
    </div>
  )
}
