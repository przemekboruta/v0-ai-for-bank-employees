"use client"

import { useState } from "react"
import { HelpCircle, ChevronDown, ChevronUp, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface StepHelpBoxProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  variant?: "info" | "tip"
}

export function StepHelpBox({
  title,
  children,
  defaultOpen = false,
  variant = "info",
}: StepHelpBoxProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [isDismissed, setIsDismissed] = useState(false)

  if (isDismissed) return null

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        variant === "info"
          ? "border-primary/15 bg-primary/[0.04]"
          : "border-chart-2/15 bg-chart-2/[0.04]"
      )}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <HelpCircle
            className={cn(
              "h-4 w-4 shrink-0",
              variant === "info" ? "text-primary/70" : "text-chart-2/70"
            )}
          />
          <span className="text-xs font-medium text-foreground">{title}</span>
          {isOpen ? (
            <ChevronUp className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="rounded-md p-1 text-muted-foreground/40 hover:text-muted-foreground"
          aria-label="Zamknij"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {isOpen && (
        <div className="mt-2 pl-6 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  )
}
