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
  "hsl(215, 70%, 50%)",
  "hsl(170, 55%, 42%)",
  "hsl(35, 85%, 55%)",
  "hsl(340, 65%, 55%)",
  "hsl(260, 50%, 55%)",
  "hsl(150, 60%, 40%)",
  "hsl(20, 75%, 52%)",
  "hsl(195, 65%, 47%)",
  "hsl(300, 40%, 50%)",
  "hsl(55, 70%, 48%)",
  "hsl(0, 60%, 50%)",
  "hsl(120, 45%, 42%)",
]
