"use client"

import React from "react"

import { cn } from "@/lib/utils"
import type { WizardStep, WizardPath } from "@/lib/clustering-types"
import {
  Upload,
  Settings2,
  Cpu,
  MessageSquareText,
  Map,
  FolderOpen,
  Brain,
  BarChart3,
} from "lucide-react"

interface StepDef {
  key: WizardStep
  label: string
  icon: React.ElementType
}

const DISCOVERY_STEPS: StepDef[] = [
  { key: "upload", label: "Dane", icon: Upload },
  { key: "configure", label: "Konfiguracja", icon: Settings2 },
  { key: "processing", label: "Analiza", icon: Cpu },
  { key: "review", label: "Przeglad AI", icon: MessageSquareText },
  { key: "explore", label: "Eksploracja", icon: Map },
]

const CLASSIFICATION_STEPS: StepDef[] = [
  { key: "upload", label: "Dane", icon: Upload },
  { key: "categories", label: "Kategorie", icon: FolderOpen },
  { key: "training", label: "Trening", icon: Brain },
  { key: "classification-results", label: "Wyniki", icon: BarChart3 },
]

const FULL_STEPS: StepDef[] = [
  { key: "upload", label: "Dane", icon: Upload },
  { key: "configure", label: "Discovery", icon: Settings2 },
  { key: "processing", label: "Analiza", icon: Cpu },
  { key: "review", label: "Przeglad", icon: MessageSquareText },
  { key: "explore", label: "Eksploracja", icon: Map },
  { key: "categories", label: "Kategorie", icon: FolderOpen },
  { key: "training", label: "Trening", icon: Brain },
  { key: "classification-results", label: "Wyniki", icon: BarChart3 },
]

const BATCH_STEPS: StepDef[] = [
  { key: "upload", label: "Dane", icon: Upload },
  { key: "classification-results", label: "Wyniki", icon: BarChart3 },
]

function getSteps(wizardPath: WizardPath): StepDef[] {
  switch (wizardPath) {
    case "classify-only":
      return CLASSIFICATION_STEPS
    case "batch":
      return BATCH_STEPS
    case "full":
    default:
      return FULL_STEPS
  }
}

interface StepIndicatorProps {
  currentStep: WizardStep
  wizardPath?: WizardPath
}

export function StepIndicator({ currentStep, wizardPath = "full" }: StepIndicatorProps) {
  const steps = getSteps(wizardPath)
  const currentIndex = steps.findIndex((s) => s.key === currentStep)

  return (
    <nav aria-label="Kroki procesu" className="flex items-center gap-1">
      {steps.map((step, idx) => {
        const Icon = step.icon
        const isActive = idx === currentIndex
        const isDone = currentIndex >= 0 && idx < currentIndex

        return (
          <div key={step.key} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-300",
                  isActive && "bg-primary/20 text-primary glow-primary",
                  isDone && "bg-white/[0.08] text-accent",
                  !isActive && !isDone && "bg-white/[0.04] text-muted-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span
                className={cn(
                  "hidden text-xs font-medium md:block transition-colors duration-300",
                  isActive && "text-foreground",
                  isDone && "text-accent",
                  !isActive && !isDone && "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={cn(
                  "mx-2 h-px w-4 lg:w-8 transition-colors duration-500",
                  isDone ? "bg-accent/40" : "bg-white/[0.06]"
                )}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}
