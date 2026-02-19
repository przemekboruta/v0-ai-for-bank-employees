"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ClusteringResult } from "@/lib/clustering-types"
import { StepReview } from "./step-review"
import { StepExplore } from "./step-explore"
import { StepOverview } from "./step-overview"
import { LayoutDashboard, MapIcon, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

interface StepResultsProps {
  result: ClusteringResult
  onResultUpdate: (result: ClusteringResult) => void
}

export function StepResults({ result, onResultUpdate }: StepResultsProps) {
  const activeCount = result.documents.filter((d) => !d.excluded).length
  const excludedCount = result.documents.length - activeCount

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-2 sm:px-4">
      {/* Summary strip - always visible for context */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {activeCount}
          </span>
          <span className="text-sm text-muted-foreground">dokumentów</span>
        </div>
        <div className="h-4 w-px bg-white/10" />
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {result.topics.length}
          </span>
          <span className="text-sm text-muted-foreground">kategorii</span>
        </div>
        {result.noise > 0 && (
          <>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-medium tabular-nums text-muted-foreground">
                {result.noise}
              </span>
              <span className="text-sm text-muted-foreground">szum</span>
            </div>
          </>
        )}
        {excludedCount > 0 && (
          <>
            <div className="h-4 w-px bg-white/10" />
            <span className="text-sm text-muted-foreground">
              {excludedCount} wyłączonych z analizy
            </span>
          </>
        )}
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="glass-subtle mb-2 flex h-12 w-full flex-wrap justify-start gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1.5 sm:mb-4">
          <TabsTrigger
            value="overview"
            className={cn(
              "gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
              "data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-none",
              "data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-white/[0.06] data-[state=inactive]:hover:text-foreground"
            )}
          >
            <LayoutDashboard className="h-4 w-4" />
            Przegląd
          </TabsTrigger>
          <TabsTrigger
            value="explore"
            className={cn(
              "gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
              "data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-none",
              "data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-white/[0.06] data-[state=inactive]:hover:text-foreground"
            )}
          >
            <MapIcon className="h-4 w-4" />
            Mapa i dane
          </TabsTrigger>
          <TabsTrigger
            value="actions"
            className={cn(
              "gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
              "data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-none",
              "data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-white/[0.06] data-[state=inactive]:hover:text-foreground"
            )}
          >
            <Sparkles className="h-4 w-4" />
            Akcje i sugestie
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 focus-visible:outline-none">
          <StepOverview result={result} />
        </TabsContent>

        <TabsContent value="explore" className="mt-4 focus-visible:outline-none">
          <StepExplore result={result} onResultUpdate={onResultUpdate} />
        </TabsContent>

        <TabsContent value="actions" className="mt-4 focus-visible:outline-none">
          <StepReview result={result} onResultUpdate={onResultUpdate} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
