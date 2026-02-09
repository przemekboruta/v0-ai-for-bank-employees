"use client"

import React from "react"

import { cn } from "@/lib/utils"
import type { Granularity } from "@/lib/clustering-types"
import { Layers, LayoutGrid, Grid3X3 } from "lucide-react"

interface StepConfigureProps {
  granularity: Granularity
  onGranularityChange: (g: Granularity) => void
  textCount: number
}

const OPTIONS: {
  value: Granularity
  label: string
  description: string
  icon: React.ElementType
  example: string
}[] = [
  {
    value: "low",
    label: "Malo kategorii",
    description: "Szerokie, ogolne tematy. Najlepsze do przegladu ogolnego.",
    icon: Layers,
    example: "3-5 kategorii",
  },
  {
    value: "medium",
    label: "Srednio kategorii",
    description:
      "Zrownowazony podzial. Dobre rozroznienie bez nadmiernej szczegolowosci.",
    icon: LayoutGrid,
    example: "5-8 kategorii",
  },
  {
    value: "high",
    label: "Duzo kategorii",
    description:
      "Szczegolowy podzial. Wychwytuje niuanse i mniejsze podtematy.",
    icon: Grid3X3,
    example: "8-12 kategorii",
  },
]

export function StepConfigure({
  granularity,
  onGranularityChange,
  textCount,
}: StepConfigureProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Ile kategorii chcesz wykryc?
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Wybierz poziom szczegolowosci kategoryzacji dla Twoich{" "}
          <span className="font-medium text-foreground">{textCount}</span>{" "}
          dokumentow. System dostosuje algorytm klasteryzacji.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon
          const selected = granularity === opt.value
          return (
            <div
              key={opt.value}
              className={cn(
                "glass-interactive flex cursor-pointer items-center gap-4 rounded-2xl p-5",
                selected && "border-primary/25 bg-primary/[0.06] glow-primary"
              )}
              onClick={() => onGranularityChange(opt.value)}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onGranularityChange(opt.value)
                }
              }}
            >
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-all duration-300",
                  selected
                    ? "bg-primary/20 text-primary glow-primary"
                    : "bg-white/[0.06] text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {opt.label}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-300",
                      selected
                        ? "bg-primary/15 text-primary"
                        : "bg-white/[0.06] text-muted-foreground"
                    )}
                  >
                    {opt.example}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {opt.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
