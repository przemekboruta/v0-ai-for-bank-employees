"use client"

import React from "react"

import { useCallback, useMemo, useRef, useState } from "react"
import type { ClusteringResult, ClusterTopic, DocumentItem } from "@/lib/clustering-types"

interface ClusterScatterPlotProps {
  result: ClusteringResult
  selectedTopicId: number | null
  onTopicSelect: (id: number | null) => void
  onDocumentHover: (doc: DocumentItem | null) => void
}

export function ClusterScatterPlot({
  result,
  selectedTopicId,
  onTopicSelect,
  onDocumentHover,
}: ClusterScatterPlotProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredDoc, setHoveredDoc] = useState<DocumentItem | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const width = 600
  const height = 480
  const padding = 40

  // Compute scale
  const { scaleX, scaleY, minX, maxX, minY, maxY } = useMemo(() => {
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
      minX: mnX,
      maxX: mxX,
      minY: mnY,
      maxY: mxY,
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
      onDocumentHover(doc)
      const svg = svgRef.current
      if (svg) {
        const rect = svg.getBoundingClientRect()
        setTooltipPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        })
      }
    },
    [onDocumentHover]
  )

  const handleDocMouseLeave = useCallback(() => {
    setHoveredDoc(null)
    onDocumentHover(null)
  }, [onDocumentHover])

  const handleBgClick = useCallback(() => {
    onTopicSelect(null)
  }, [onTopicSelect])

  return (
    <div className="relative w-full overflow-hidden rounded-xl border bg-card">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        onClick={handleBgClick}
      >
        {/* Background */}
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          fill="hsl(210, 20%, 98%)"
          rx="12"
        />

        {/* Grid lines */}
        {Array.from({ length: 5 }).map((_, i) => {
          const xPos = padding + ((width - 2 * padding) / 4) * i
          const yPos = padding + ((height - 2 * padding) / 4) * i
          return (
            <g key={`grid-${i}`}>
              <line
                x1={xPos}
                y1={padding}
                x2={xPos}
                y2={height - padding}
                stroke="hsl(215, 15%, 92%)"
                strokeWidth="0.5"
              />
              <line
                x1={padding}
                y1={yPos}
                x2={width - padding}
                y2={yPos}
                stroke="hsl(215, 15%, 92%)"
                strokeWidth="0.5"
              />
            </g>
          )
        })}

        {/* Cluster hulls / labels */}
        {result.topics.map((topic) => {
          const cx = scaleX(topic.centroidX)
          const cy = scaleY(topic.centroidY)
          const isSelected = selectedTopicId === topic.id
          const isOther = selectedTopicId !== null && selectedTopicId !== topic.id

          return (
            <g key={`label-${topic.id}`}>
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 52 : 42}
                fill={topic.color}
                opacity={isOther ? 0.04 : 0.08}
                className="transition-all duration-300"
              />
              <text
                x={cx}
                y={cy - 48}
                textAnchor="middle"
                className="text-[9px] font-semibold"
                fill={isOther ? "hsl(215, 10%, 75%)" : topic.color}
                opacity={isOther ? 0.4 : 0.9}
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
          const isSelected = selectedTopicId === doc.clusterId
          const isOther =
            selectedTopicId !== null && selectedTopicId !== doc.clusterId
          const isHovered = hoveredDoc?.id === doc.id

          return (
            <circle
              key={doc.id}
              cx={cx}
              cy={cy}
              r={isHovered ? 5 : 3}
              fill={topic.color}
              opacity={isOther ? 0.12 : isHovered ? 1 : 0.65}
              stroke={isHovered ? "hsl(0, 0%, 100%)" : "none"}
              strokeWidth={isHovered ? 2 : 0}
              className="cursor-pointer transition-all duration-200"
              onMouseEnter={(e) => handleDocMouseEnter(doc, e)}
              onMouseLeave={handleDocMouseLeave}
              onClick={(e) => {
                e.stopPropagation()
                onTopicSelect(
                  selectedTopicId === doc.clusterId ? null : doc.clusterId
                )
              }}
            />
          )
        })}
      </svg>

      {/* Tooltip */}
      {hoveredDoc && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-lg border bg-popover px-3 py-2 shadow-lg"
          style={{
            left: `${Math.min(tooltipPos.x + 12, 400)}px`,
            top: `${tooltipPos.y - 10}px`,
            transform: "translateY(-100%)",
          }}
        >
          <p className="text-xs leading-relaxed text-popover-foreground">
            {hoveredDoc.text.length > 120
              ? `${hoveredDoc.text.substring(0, 120)}...`
              : hoveredDoc.text}
          </p>
          <p className="mt-1 text-[10px] font-medium" style={{ color: topicMap.get(hoveredDoc.clusterId)?.color }}>
            {topicMap.get(hoveredDoc.clusterId)?.label}
          </p>
        </div>
      )}
    </div>
  )
}
