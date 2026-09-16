export type InteractionType = 'question' | 'feedback' | 'rating' | 'poll' | 'reaction'
export type ModerationState = 'pending' | 'visible' | 'hidden' | 'answered' | 'deleted'

export type EventRecord = {
  id: string
  code: string
  name: string
  description: string
  status: 'active' | 'inactive'
  config: Record<string, unknown>
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

export type InteractionRecord = {
  id: string
  eventId: string
  type: InteractionType
  prompt: string
  options: string[]
  settings: Record<string, unknown>
  status: 'active' | 'inactive'
  ordering: number
  createdAt: string
}

export type MetricTimelinePoint = {
  time: string
  value: number
}

export type EventSnapshot = {
  event: EventRecord
  interactions: InteractionRecord[]
  metrics: {
    totalResponses: number
    questionCount: number
    pollResponses: number
    pollParticipation: number
    averageRating: number
    reactionCount: number
    timeline: MetricTimelinePoint[]
  }
  analytics: {
    sentiment: {
      positive: number
      neutral: number
      negative: number
    }
    themes: Array<{ theme: string; count: number }>
    keywords: Array<{ word: string; count: number }>
    wordCloud: Array<{ word: string; count: number; weight: number }>
    timeline: MetricTimelinePoint[]
    emergingConcerns: string[]
    pendingAnalyses: number
    totalTextResponses: number
  }
  questionStream: Array<{
    id: string
    interactionId: string
    interactionPrompt: string
    text: string
    createdAt: string
    timeLabel: string
    moderationState: ModerationState
    highlighted: boolean
  }>
  presenterQuestions: Array<{
    id: string
    interactionId: string
    interactionPrompt: string
    text: string
    createdAt: string
    timeLabel: string
    moderationState: ModerationState
    highlighted: boolean
  }>
  pollResults: Array<{
    id: string
    prompt: string
    totalVotes: number
    allowMultiple: boolean
    options: Array<{ label: string; value: number }>
  }>
  ratingResults: Array<{
    id: string
    prompt: string
    average: number
    responses: number
    scale: number
  }>
  reactionTotals: Array<{ label: string; value: number }>
}

export type EventPageData = {
  event: EventRecord
  interactions: InteractionRecord[]
  snapshot: EventSnapshot
  privacy: {
    notice: string
  }
}

export type EventSocketPayload = {
  admin: EventSnapshot
  publicView: EventSnapshot
}
