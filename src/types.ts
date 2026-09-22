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

export type AnonymousAttendeeProfile = {
  attendeeKey: string
  nickname: string
}

export type IdeaFeedItem = {
  id: string
  interactionId: string
  interactionPrompt: string
  text: string
  createdAt: string
  timeLabel: string
  nickname: string
  sentiment: 'positive' | 'neutral' | 'negative'
  votes: {
    up: number
    down: number
    score: number
  }
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
    uniqueParticipants: number
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
    votes: {
      up: number
      score: number
    }
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
    votes: {
      up: number
      score: number
    }
  }>
  ideaFeed: IdeaFeedItem[]
  activePoll: {
    id: string
    prompt: string
    totalVotes: number
    allowMultiple: boolean
    options: Array<{ label: string; value: number }>
    active: boolean
  } | null
  pollResults: Array<{
    id: string
    prompt: string
    totalVotes: number
    allowMultiple: boolean
    active: boolean
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

export type ConvexRuntimeConfig = {
  enabled: boolean
  url: string | null
}

export type EventPageData = {
  event: EventRecord
  interactions: InteractionRecord[]
  snapshot: EventSnapshot
  privacy: {
    notice: string
  }
  convex?: ConvexRuntimeConfig
}

export type EventSocketPayload = {
  admin: EventSnapshot
  publicView: EventSnapshot
}

export type OrganizerSummary = {
  email: string
}

export type AuthSession = {
  authenticated: boolean
  organizer: OrganizerSummary | null
  canRegister: boolean
}

export type DemoMeta = {
  demoEnabled: boolean
  demoCode: string | null
}
