"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { ModelInfo } from "@/lib/clustering-types"
import { listModels, deleteModel } from "@/lib/api-client"
import {
  Brain,
  Trash2,
  Play,
  Loader2,
  RefreshCw,
} from "lucide-react"

interface ModelManagerProps {
  onUseModel: (modelId: string) => void
}

export function ModelManager({ onUseModel }: ModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchModels = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await listModels()
      setModels(data)
    } catch {
      // Backend not available
      setModels([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  const handleDelete = useCallback(
    async (modelId: string) => {
      setDeletingId(modelId)
      try {
        await deleteModel(modelId)
        setModels((prev) => prev.filter((m) => m.modelId !== modelId))
      } catch (error) {
        console.error("Failed to delete model:", error)
      } finally {
        setDeletingId(null)
      }
    },
    []
  )

  if (models.length === 0 && !isLoading) {
    return null
  }

  return (
    <div className="glass rounded-2xl border border-white/[0.1] p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-semibold text-foreground">
            Zapisane modele
          </h3>
          <Badge variant="secondary" className="border-0 bg-white/[0.06] text-[10px] text-muted-foreground">
            {models.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchModels}
          disabled={isLoading}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {isLoading && models.length === 0 ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {models.map((model) => (
            <div
              key={model.modelId}
              className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {model.name}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{model.categoryCount} kat.</span>
                  <span>|</span>
                  <span>Dok.: {Math.round(model.accuracy * 100)}%</span>
                  <span>|</span>
                  <span>{new Date(model.savedAt).toLocaleDateString("pl-PL")}</span>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => onUseModel(model.modelId)}
                className="gap-1.5 bg-primary/90 text-primary-foreground hover:bg-primary"
              >
                <Play className="h-3 w-3" />
                Uzyj
              </Button>
              <button
                type="button"
                onClick={() => handleDelete(model.modelId)}
                disabled={deletingId === model.modelId}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                {deletingId === model.modelId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
