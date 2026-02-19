"use client"

import React from "react"

import { cn } from "@/lib/utils"
import type { WizardStep } from "@/lib/clustering-types"
import { Upload, Settings2, Cpu, Map } from "lucide-react"

const STEPS: { key: WizardStep; label: string; icon: React.ElementType }[] = [
  { key: "upload", label: "Dane", icon: Upload },
  { key: "configure", label: "Konfiguracja", icon: Settings2 },
  { key: "processing", label: "Analiza", icon: Cpu },
  { key: "explore", label: "Wyniki", icon: Map },
]

const STEP_ORDER: WizardStep[] = ["upload", "configure", "processing", "explore"]

function getStepIndex(step: WizardStep) {
  // Dashboard is not part of the indicator; treat it as before upload
  if (step === "dashboard") return -1
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
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-2 h-px w-4 lg:w-8 transition-colors duration-500",
                  idx < currentIndex ? "bg-accent/40" : "bg-white/[0.06]"
                )}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}
