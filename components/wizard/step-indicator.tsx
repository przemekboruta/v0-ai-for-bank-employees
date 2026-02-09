"use client"

import React from "react"

import { cn } from "@/lib/utils"
import type { WizardStep } from "@/lib/clustering-types"
import { Upload, Settings2, Cpu, MessageSquareText, Map } from "lucide-react"

const STEPS: { key: WizardStep; label: string; icon: React.ElementType }[] = [
  { key: "upload", label: "Dane", icon: Upload },
  { key: "configure", label: "Konfiguracja", icon: Settings2 },
  { key: "processing", label: "Analiza", icon: Cpu },
  { key: "review", label: "Przegląd AI", icon: MessageSquareText },
  { key: "explore", label: "Eksploracja", icon: Map },
]

const STEP_ORDER: WizardStep[] = ["upload", "configure", "processing", "review", "explore"]

function getStepIndex(step: WizardStep) {
  return STEP_ORDER.indexOf(step)
}

interface StepIndicatorProps {
  currentStep: WizardStep
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  const currentIndex = getStepIndex(currentStep)

  return (
    <nav aria-label="Kroki procesu" className="flex items-center gap-1">
      {STEPS.map((step, idx) => {
        const Icon = step.icon
        const isActive = idx === currentIndex
        const isDone = idx < currentIndex

        return (
          <div key={step.key} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-all",
                  isActive && "bg-primary text-primary-foreground shadow-sm",
                  isDone && "bg-primary/15 text-primary",
                  !isActive && !isDone && "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span
                className={cn(
                  "hidden text-sm font-medium md:block",
                  isActive && "text-foreground",
                  isDone && "text-primary",
                  !isActive && !isDone && "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-3 h-px w-6 lg:w-10",
                  idx < currentIndex ? "bg-primary/40" : "bg-border"
                )}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}
