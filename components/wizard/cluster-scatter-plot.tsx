"use client"

import React from "react"

import { useCallback, useMemo, useRef, useState } from "react"
import type {
  ClusteringResult,
  ClusterTopic,
  DocumentItem,
} from "@/lib/clustering-types"

interface ClusterScatterPlotProps {
  result: ClusteringResult
  selectedTopicId: number | null
  onTopicSelect: (id: number | null) => void
  onDocumentClick: (doc: DocumentItem) => void
}

export function ClusterScatterPlot({
  result,
  selectedTopicId,
  onTopicSelect,
  onDocumentClick,
}: ClusterScatterPlotProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredDoc, setHoveredDoc] = useState<DocumentItem | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const width = 700
  const height = 500
  const padding = 50

  const { scaleX, scaleY } = useMemo(() => {
    const docs = result.documents
    const xs = docs.map((d) => d.x)
    const ys = docs.map((d) => d.y)
    const mnX = Math.min(...xs) - 5
    const mxX = Math.max(...xs) + 5
    const mnY = Math.min(...ys) - 5
    const mxY = Math.max(...ys) + 5

    return {
      scaleX: (v: number) =>
        padding + ((v - mnX) / (mxX - mnX)) * (width - 2 * padding),
      scaleY: (v: number) =>
        padding + ((v - mnY) / (mxY - mnY)) * (height - 2 * padding),
    }
  }, [result.documents])

  const topicMap = useMemo(() => {
    const map = new Map<number, ClusterTopic>()
    for (const t of result.topics) {
      map.set(t.id, t)
    }
    return map
  }, [result.topics])

  const handleDocMouseEnter = useCallback(
    (doc: DocumentItem, e: React.MouseEvent) => {
      setHoveredDoc(doc)
      const svg = svgRef.current
      if (svg) {
        const rect = svg.getBoundingClientRect()
        setTooltipPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        })
      }
    },
    []
  )

  const handleDocMouseLeave = useCallback(() => {
    setHoveredDoc(null)
  }, [])

  const handleBgClick = useCallback(() => {
    onTopicSelect(null)
  }, [onTopicSelect])

  return (
    <div className="glass relative w-full overflow-hidden rounded-2xl">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        onClick={handleBgClick}
      >
        <defs>
          {result.topics.map((topic) => (
            <radialGradient key={`grad-${topic.id}`} id={`glow-${topic.id}`}>
              <stop offset="0%" stopColor={topic.color} stopOpacity="0.15" />
              <stop offset="70%" stopColor={topic.color} stopOpacity="0.03" />
              <stop offset="100%" stopColor={topic.color} stopOpacity="0" />
            </radialGradient>
          ))}
          <filter id="blur-glow">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          fill="transparent"
          rx="16"
        />

        {/* Grid */}
        {Array.from({ length: 6 }).map((_, i) => {
          const xPos = padding + ((width - 2 * padding) / 5) * i
          const yPos = padding + ((height - 2 * padding) / 5) * i
          return (
            <g key={`grid-${i}`}>
              <line
                x1={xPos}
                y1={padding}
                x2={xPos}
                y2={height - padding}
                stroke="white"
                strokeOpacity="0.03"
                strokeWidth="0.5"
              />
              <line
                x1={padding}
                y1={yPos}
                x2={width - padding}
                y2={yPos}
                stroke="white"
                strokeOpacity="0.03"
                strokeWidth="0.5"
              />
            </g>
          )
        })}

        {/* Cluster glow areas */}
        {result.topics.map((topic) => {
          const cx = scaleX(topic.centroidX)
          const cy = scaleY(topic.centroidY)
          const isSelected = selectedTopicId === topic.id
          const isOther =
            selectedTopicId !== null && selectedTopicId !== topic.id

          return (
            <g key={`area-${topic.id}`}>
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 65 : 50}
                fill={`url(#glow-${topic.id})`}
                opacity={isOther ? 0.2 : 1}
                className="transition-all duration-500"
              />
              <text
                x={cx}
                y={cy - 55}
                textAnchor="middle"
                fontSize="9"
                fontWeight="600"
                fill={topic.color}
                opacity={isOther ? 0.2 : 0.85}
                className="transition-all duration-500"
                style={{ fontFamily: "var(--font-space-grotesk), system-ui" }}
              >
                {topic.label.length > 24
                  ? `${topic.label.substring(0, 22)}...`
                  : topic.label}
              </text>
            </g>
          )
        })}

        {/* Document dots */}
        {result.documents.map((doc) => {
          const topic = topicMap.get(doc.clusterId)
          if (!topic) return null
          const cx = scaleX(doc.x)
          const cy = scaleY(doc.y)
          const isOther =
            selectedTopicId !== null && selectedTopicId !== doc.clusterId
          const isHovered = hoveredDoc?.id === doc.id

          return (
            <g key={doc.id}>
              {isHovered && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={12}
                  fill={topic.color}
                  opacity={0.25}
                  filter="url(#blur-glow)"
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? 5.5 : 3}
                fill={topic.color}
                opacity={isOther ? 0.1 : isHovered ? 1 : 0.55}
                stroke={isHovered ? "white" : "none"}
                strokeWidth={isHovered ? 1.5 : 0}
                strokeOpacity={0.6}
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={(e) => handleDocMouseEnter(doc, e)}
                onMouseLeave={handleDocMouseLeave}
                onClick={(e) => {
                  e.stopPropagation()
                  onDocumentClick(doc)
                }}
              />
            </g>
          )
        })}
      </svg>

      {/* Tooltip */}
      {hoveredDoc && (
        <div
          className="glass-strong pointer-events-none absolute z-10 max-w-xs rounded-xl px-4 py-3"
          style={{
            left: `${Math.min(tooltipPos.x + 14, 450)}px`,
            top: `${tooltipPos.y - 12}px`,
            transform: "translateY(-100%)",
          }}
        >
          <p className="text-xs leading-relaxed text-foreground/90">
            {hoveredDoc.text.length > 120
              ? `${hoveredDoc.text.substring(0, 120)}...`
              : hoveredDoc.text}
          </p>
          <div className="mt-1.5 flex items-center justify-between">
            <p
              className="text-[10px] font-semibold"
              style={{ color: topicMap.get(hoveredDoc.clusterId)?.color }}
            >
              {topicMap.get(hoveredDoc.clusterId)?.label}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Kliknij, aby otworzyc
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
