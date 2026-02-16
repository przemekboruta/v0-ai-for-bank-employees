"use client"

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  ClusteringResult,
  ClusterTopic,
  DocumentItem,
} from "@/lib/clustering-types"
import { ZoomIn, ZoomOut, Maximize2, Locate } from "lucide-react"
import { cn } from "@/lib/utils"

interface ClusterScatterPlotProps {
  result: ClusteringResult
  selectedTopicId: number | null
  onTopicSelect: (id: number | null) => void
  onDocumentClick: (doc: DocumentItem) => void
}

// Internal coordinate space
const WORLD_W = 1000
const WORLD_H = 700
const PAD = 80

const MIN_ZOOM = 0.4
const MAX_ZOOM = 8
const ZOOM_STEP = 1.25

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export function ClusterScatterPlot({
  result,
  selectedTopicId,
  onTopicSelect,
  onDocumentClick,
}: ClusterScatterPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  // --- Camera state ---
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)

  // --- Interaction state ---
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const [hoveredDoc, setHoveredDoc] = useState<DocumentItem | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [mounted, setMounted] = useState(false)

  // Entry animation
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100)
    return () => clearTimeout(t)
  }, [])

  // --- Scale functions ---
  const { scaleX, scaleY, bounds } = useMemo(() => {
    const docs = result.documents
    if (docs.length === 0) {
      return {
        scaleX: (v: number) => v,
        scaleY: (v: number) => v,
        bounds: { mnX: 0, mxX: 1, mnY: 0, mxY: 1 },
      }
    }
    const xs = docs.map((d) => d.x)
    const ys = docs.map((d) => d.y)
    const mnX = Math.min(...xs) - 5
    const mxX = Math.max(...xs) + 5
    const mnY = Math.min(...ys) - 5
    const mxY = Math.max(...ys) + 5

    return {
      scaleX: (v: number) =>
        PAD + ((v - mnX) / (mxX - mnX)) * (WORLD_W - 2 * PAD),
      scaleY: (v: number) =>
        PAD + ((v - mnY) / (mxY - mnY)) * (WORLD_H - 2 * PAD),
      bounds: { mnX, mxX, mnY, mxY },
    }
  }, [result.documents])

  const topicMap = useMemo(() => {
    const map = new Map<number, ClusterTopic>()
    for (const t of result.topics) map.set(t.id, t)
    return map
  }, [result.topics])

  // --- Wheel zoom ---
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM)
      const ratio = newZoom / zoom

      // Zoom towards cursor
      const newPanX = mx - ratio * (mx - panX)
      const newPanY = my - ratio * (my - panY)

      setZoom(newZoom)
      setPanX(newPanX)
      setPanY(newPanY)
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoom, panX, panY])

  // --- Mouse drag ---
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      setIsDragging(true)
      dragStart.current = { x: e.clientX, y: e.clientY, panX, panY }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [panX, panY]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setPanX(dragStart.current.panX + dx)
        setPanY(dragStart.current.panY + dy)
      })
    },
    [isDragging]
  )

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // --- Zoom controls ---
  const zoomTo = useCallback(
    (factor: number) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.width / 2
      const cy = rect.height / 2
      const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM)
      const ratio = newZoom / zoom
      setPanX(cx - ratio * (cx - panX))
      setPanY(cy - ratio * (cy - panY))
      setZoom(newZoom)
    },
    [zoom, panX, panY]
  )

  const resetView = useCallback(() => {
    setZoom(1)
    setPanX(0)
    setPanY(0)
  }, [])

  const fitToSelection = useCallback(() => {
    if (selectedTopicId === null) {
      resetView()
      return
    }
    const docs = result.documents.filter(
      (d) => d.clusterId === selectedTopicId
    )
    if (docs.length === 0) return

    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()

    const xs = docs.map((d) => scaleX(d.x))
    const ys = docs.map((d) => scaleY(d.y))
    const minX = Math.min(...xs) - 40
    const maxX = Math.max(...xs) + 40
    const minY = Math.min(...ys) - 40
    const maxY = Math.max(...ys) + 40

    const clusterW = maxX - minX
    const clusterH = maxY - minY
    const fitZoom = clamp(
      Math.min(rect.width / clusterW, rect.height / clusterH) * 0.85,
      MIN_ZOOM,
      MAX_ZOOM
    )

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    setZoom(fitZoom)
    setPanX(rect.width / 2 - centerX * fitZoom)
    setPanY(rect.height / 2 - centerY * fitZoom)
  }, [selectedTopicId, result.documents, scaleX, scaleY, resetView])

  // --- Hover ---
  const handleDocEnter = useCallback(
    (doc: DocumentItem, e: React.MouseEvent) => {
      setHoveredDoc(doc)
      const el = containerRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        setTooltipPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        })
      }
    },
    []
  )

  const handleDocLeave = useCallback(() => setHoveredDoc(null), [])

  // --- Viewbox for SVG ---
  const viewBox = useMemo(() => {
    const vbX = -panX / zoom
    const vbY = -panY / zoom
    const el = containerRef.current
    const w = el ? el.clientWidth / zoom : WORLD_W
    const h = el ? el.clientHeight / zoom : WORLD_H
    return `${vbX} ${vbY} ${w} ${h}`
  }, [panX, panY, zoom])

  // --- Minimap ---
  const minimapSize = { w: 120, h: 84 }

  return (
    <div className="relative flex flex-col gap-3">
      {/* Main canvas */}
      <div
        ref={containerRef}
        className={cn(
          "glass relative w-full overflow-hidden rounded-2xl",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        style={{ height: 520, touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <svg
          viewBox={viewBox}
          className="h-full w-full select-none"
          preserveAspectRatio="xMidYMid meet"
          style={{
            transition: isDragging ? "none" : "viewBox 0.35s cubic-bezier(.22,1,.36,1)",
          }}
        >
          <defs>
            {result.topics.map((topic) => (
              <radialGradient
                key={`grad-${topic.id}`}
                id={`glow-${topic.id}`}
              >
                <stop offset="0%" stopColor={topic.color} stopOpacity="0.18" />
                <stop
                  offset="60%"
                  stopColor={topic.color}
                  stopOpacity="0.04"
                />
                <stop
                  offset="100%"
                  stopColor={topic.color}
                  stopOpacity="0"
                />
              </radialGradient>
            ))}
            <filter id="blur-glow">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <filter id="label-shadow">
              <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="black" floodOpacity="0.6" />
            </filter>
          </defs>

          {/* Grid */}
          {Array.from({ length: 8 }).map((_, i) => {
            const x = PAD + ((WORLD_W - 2 * PAD) / 7) * i
            const y = PAD + ((WORLD_H - 2 * PAD) / 7) * i
            return (
              <g key={`grid-${i}`}>
                <line
                  x1={x}
                  y1={PAD}
                  x2={x}
                  y2={WORLD_H - PAD}
                  stroke="white"
                  strokeOpacity="0.025"
                  strokeWidth={0.8 / zoom}
                />
                {i < 8 && (
                  <line
                    x1={PAD}
                    y1={y}
                    x2={WORLD_W - PAD}
                    y2={y}
                    stroke="white"
                    strokeOpacity="0.025"
                    strokeWidth={0.8 / zoom}
                  />
                )}
              </g>
            )
          })}

          {/* Cluster halos */}
          {result.topics.map((topic) => {
            const cx = scaleX(topic.centroidX)
            const cy = scaleY(topic.centroidY)
            const isSelected = selectedTopicId === topic.id
            const isOther =
              selectedTopicId !== null && selectedTopicId !== topic.id
            const docCount = topic.documentCount
            const radius = Math.max(40, Math.min(120, docCount * 3))

            return (
              <g key={`halo-${topic.id}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? radius * 1.3 : radius}
                  fill={`url(#glow-${topic.id})`}
                  opacity={isOther ? 0.12 : mounted ? 1 : 0}
                  style={{
                    transition:
                      "r 0.6s cubic-bezier(.22,1,.36,1), opacity 0.5s ease",
                    transitionDelay: mounted ? "0s" : `${topic.id * 0.08}s`,
                  }}
                />
                {/* Halo ring when selected */}
                {isSelected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius * 1.3 + 4}
                    fill="none"
                    stroke={topic.color}
                    strokeWidth={1.2 / zoom}
                    strokeOpacity={0.25}
                    strokeDasharray={`${4 / zoom} ${6 / zoom}`}
                    style={{
                      transition: "r 0.6s cubic-bezier(.22,1,.36,1)",
                    }}
                  >
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from={`0 ${cx} ${cy}`}
                      to={`360 ${cx} ${cy}`}
                      dur="30s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
              </g>
            )
          })}

          {/* Cluster labels */}
          {result.topics.map((topic) => {
            const cx = scaleX(topic.centroidX)
            const cy = scaleY(topic.centroidY)
            const isOther =
              selectedTopicId !== null && selectedTopicId !== topic.id
            const fontSize = clamp(11 / zoom, 6, 14)

            return (
              <text
                key={`label-${topic.id}`}
                x={cx}
                y={cy - 60}
                textAnchor="middle"
                fontSize={fontSize}
                fontWeight="700"
                fill={topic.color}
                opacity={isOther ? 0.15 : mounted ? 0.9 : 0}
                filter="url(#label-shadow)"
                style={{
                  fontFamily: "var(--font-space-grotesk), system-ui",
                  transition: "opacity 0.5s ease",
                  transitionDelay: mounted ? "0s" : `${0.3 + topic.id * 0.06}s`,
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onTopicSelect(
                    selectedTopicId === topic.id ? null : topic.id
                  )
                }}
              >
                {topic.label.length > 28
                  ? `${topic.label.substring(0, 26)}...`
                  : topic.label}
              </text>
            )
          })}

          {/* Document dots */}
          {result.documents.map((doc, idx) => {
            const topic = topicMap.get(doc.clusterId)
            if (!topic) return null
            const cx = scaleX(doc.x)
            const cy = scaleY(doc.y)
            const isOther =
              selectedTopicId !== null && selectedTopicId !== doc.clusterId
            const isHovered = hoveredDoc?.id === doc.id
            const baseR = clamp(3.5 / Math.sqrt(zoom), 1.5, 6)
            const r = isHovered ? baseR * 2 : baseR

            // Staggered entry delay
            const stagger = Math.min(idx * 2, 800)

            return (
              <g key={doc.id}>
                {/* Hover glow */}
                {isHovered && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r * 4}
                    fill={topic.color}
                    opacity={0.2}
                    filter="url(#blur-glow)"
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={topic.color}
                  opacity={
                    !mounted
                      ? 0
                      : isOther
                        ? 0.07
                        : isHovered
                          ? 1
                          : 0.55
                  }
                  stroke={isHovered ? "white" : "none"}
                  strokeWidth={isHovered ? 1.5 / zoom : 0}
                  strokeOpacity={0.7}
                  className="pointer-events-auto"
                  style={{
                    cursor: "pointer",
                    transition: `opacity 0.35s ease, r 0.25s cubic-bezier(.22,1,.36,1), transform 0.6s cubic-bezier(.22,1,.36,1)`,
                    transitionDelay: mounted ? "0ms" : `${stagger}ms`,
                    transformOrigin: `${cx}px ${cy}px`,
                    transform: mounted ? "scale(1)" : "scale(0)",
                  }}
                  onMouseEnter={(e) => handleDocEnter(doc, e)}
                  onMouseLeave={handleDocLeave}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDocumentClick(doc)
                  }}
                />
              </g>
            )
          })}
        </svg>

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => zoomTo(ZOOM_STEP)}
            className="glass-strong flex h-8 w-8 items-center justify-center rounded-lg text-foreground/70 transition-all duration-200 hover:bg-white/[0.1] hover:text-foreground"
            title="Przybliz"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => zoomTo(1 / ZOOM_STEP)}
            className="glass-strong flex h-8 w-8 items-center justify-center rounded-lg text-foreground/70 transition-all duration-200 hover:bg-white/[0.1] hover:text-foreground"
            title="Oddal"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <div className="my-0.5 h-px w-full bg-white/[0.08]" />
          <button
            type="button"
            onClick={resetView}
            className="glass-strong flex h-8 w-8 items-center justify-center rounded-lg text-foreground/70 transition-all duration-200 hover:bg-white/[0.1] hover:text-foreground"
            title="Resetuj widok"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          {selectedTopicId !== null && (
            <button
              type="button"
              onClick={fitToSelection}
              className="glass-strong flex h-8 w-8 items-center justify-center rounded-lg text-accent transition-all duration-200 hover:bg-white/[0.1]"
              title="Przejdz do wybranej kategorii"
            >
              <Locate className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Zoom level indicator */}
        <div className="absolute bottom-4 left-4 rounded-lg px-2.5 py-1 text-[10px] font-medium text-muted-foreground glass-subtle">
          {Math.round(zoom * 100)}%
        </div>

        {/* Minimap */}
        <div className="glass-strong absolute top-4 right-4 overflow-hidden rounded-lg" style={{ width: minimapSize.w, height: minimapSize.h }}>
          <svg
            viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
            className="h-full w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <rect x={0} y={0} width={WORLD_W} height={WORLD_H} fill="transparent" />
            {/* Topic clusters as small dots */}
            {result.topics.map((topic) => {
              const cx = scaleX(topic.centroidX)
              const cy = scaleY(topic.centroidY)
              return (
                <circle
                  key={`mm-${topic.id}`}
                  cx={cx}
                  cy={cy}
                  r={Math.max(8, Math.min(30, topic.documentCount * 1.5))}
                  fill={topic.color}
                  opacity={selectedTopicId === null || selectedTopicId === topic.id ? 0.35 : 0.08}
                />
              )
            })}
            {/* Viewport rectangle */}
            {containerRef.current && (
              <rect
                x={-panX / zoom}
                y={-panY / zoom}
                width={containerRef.current.clientWidth / zoom}
                height={containerRef.current.clientHeight / zoom}
                fill="none"
                stroke="hsl(210, 100%, 62%)"
                strokeWidth={3}
                strokeOpacity={0.5}
                rx={4}
              />
            )}
          </svg>
        </div>

        {/* Tooltip */}
        {hoveredDoc && (
          <div
            className="glass-strong pointer-events-none absolute z-20 max-w-xs rounded-xl px-4 py-3"
            style={{
              left: `${clamp(tooltipPos.x + 16, 0, 400)}px`,
              top: `${tooltipPos.y - 14}px`,
              transform: "translateY(-100%)",
              animation: "tooltip-in 0.15s ease-out",
            }}
          >
            <p className="text-xs leading-relaxed text-foreground/90">
              {hoveredDoc.text.length > 140
                ? `${hoveredDoc.text.substring(0, 140)}...`
                : hoveredDoc.text}
            </p>
            <div className="mt-1.5 flex items-center justify-between gap-4">
              <p
                className="text-[10px] font-semibold"
                style={{ color: topicMap.get(hoveredDoc.clusterId)?.color }}
              >
                {topicMap.get(hoveredDoc.clusterId)?.label}
              </p>
              <p className="shrink-0 text-[10px] text-muted-foreground">
                Kliknij, aby otworzyc
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Legend strip below the chart */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2">
        <span className="text-[10px] text-muted-foreground/60">
          Scroll = zoom / Przeciagnij = przesuniecie
        </span>
        <span className="text-[10px] text-muted-foreground/40">|</span>
        <span className="text-[10px] text-muted-foreground/60">
          {result.documents.length} dokumentów w {result.topics.length} klastrach
        </span>
      </div>
    </div>
  )
}
