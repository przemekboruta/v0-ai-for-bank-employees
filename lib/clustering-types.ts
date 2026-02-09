export type Granularity = "low" | "medium" | "high"

export interface DocumentItem {
  id: string
  text: string
  clusterId: number
  x: number
  y: number
}

export interface ClusterTopic {
  id: number
  label: string
  description: string
  documentCount: number
  sampleTexts: string[]
  color: string
  centroidX: number
  centroidY: number
  coherenceScore: number
  keywords: string[]
}

export interface LLMSuggestion {
  type: "merge" | "split" | "rename" | "reclassify"
  description: string
  targetClusterIds: number[]
  suggestedLabel?: string
  confidence: number
  applied: boolean
}

export interface ClusteringResult {
  documents: DocumentItem[]
  topics: ClusterTopic[]
  llmSuggestions: LLMSuggestion[]
  totalDocuments: number
  noise: number
}

export type WizardStep = "upload" | "configure" | "processing" | "review" | "explore"

export const CLUSTER_COLORS = [
  "hsl(210, 100%, 65%)",
  "hsl(175, 70%, 55%)",
  "hsl(40, 90%, 62%)",
  "hsl(340, 75%, 62%)",
  "hsl(265, 60%, 65%)",
  "hsl(150, 65%, 52%)",
  "hsl(20, 85%, 60%)",
  "hsl(195, 75%, 58%)",
  "hsl(300, 50%, 62%)",
  "hsl(55, 80%, 55%)",
  "hsl(0, 70%, 60%)",
  "hsl(120, 55%, 52%)",
]
