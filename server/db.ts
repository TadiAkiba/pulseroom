import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

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

export type ResponseRecord = {
  id: string
  eventId: string
  interactionId: string
  responseType: InteractionType
  content: Record<string, unknown>
  moderationState: ModerationState
  highlighted: boolean
  createdAt: string
}

export type AnalysisRecord = {
  id: string
  responseId: string
  eventId: string
  sentiment: 'positive' | 'neutral' | 'negative'
  keywords: string[]
  themes: string[]
  summary: string
  createdAt: string
}

const dataPath = path.resolve(process.cwd(), 'data')
const dbFile = path.join(dataPath, 'engagement.sqlite')

fs.mkdirSync(dataPath, { recursive: true })

export const db = new Database(dbFile)

db.pragma('journal_mode = WAL')

type RawRow = Record<string, unknown>

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function rowToEvent(row: RawRow): EventRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    description: String(row.description ?? ''),
    status: row.status === 'inactive' ? 'inactive' : 'active',
    config: parseJson<Record<string, unknown>>(row.config, {}),
    isDemo: Boolean(row.is_demo),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToInteraction(row: RawRow): InteractionRecord {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    type: String(row.type) as InteractionType,
    prompt: String(row.prompt),
    options: parseJson<string[]>(row.options_json, []),
    settings: parseJson<Record<string, unknown>>(row.settings_json, {}),
    status: row.status === 'inactive' ? 'inactive' : 'active',
    ordering: Number(row.ordering ?? 0),
    createdAt: String(row.created_at),
  }
}

function rowToResponse(row: RawRow): ResponseRecord {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    interactionId: String(row.interaction_id),
    responseType: String(row.response_type) as InteractionType,
    content: parseJson<Record<string, unknown>>(row.content_json, {}),
    moderationState: String(row.moderation_state) as ModerationState,
    highlighted: Boolean(row.highlighted),
    createdAt: String(row.created_at),
  }
}

function rowToAnalysis(row: RawRow): AnalysisRecord {
  return {
    id: String(row.id),
    responseId: String(row.response_id),
    eventId: String(row.event_id),
    sentiment: String(row.sentiment) as AnalysisRecord['sentiment'],
    keywords: parseJson<string[]>(row.keywords_json, []),
    themes: parseJson<string[]>(row.themes_json, []),
    summary: String(row.summary ?? ''),
    createdAt: String(row.created_at),
  }
}

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      config TEXT NOT NULL DEFAULT '{}',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      settings_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      ordering INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events (id)
    );

    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      response_type TEXT NOT NULL,
      content_json TEXT NOT NULL,
      moderation_state TEXT NOT NULL DEFAULT 'visible',
      highlighted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events (id),
      FOREIGN KEY (interaction_id) REFERENCES interactions (id)
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      response_id TEXT NOT NULL UNIQUE,
      event_id TEXT NOT NULL,
      sentiment TEXT NOT NULL,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      themes_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (response_id) REFERENCES responses (id),
      FOREIGN KEY (event_id) REFERENCES events (id)
    );
  `)
}

function generateEventCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  while (true) {
    const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
    const exists = db.prepare('SELECT id FROM events WHERE code = ?').get(code)
    if (!exists) {
      return code
    }
  }
}

export function listEvents() {
  const rows = db.prepare('SELECT * FROM events ORDER BY created_at DESC').all() as RawRow[]
  return rows.map(rowToEvent)
}

export function getEventById(id: string) {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as RawRow | undefined
  return row ? rowToEvent(row) : null
}

export function getEventByCode(code: string) {
  const row = db.prepare('SELECT * FROM events WHERE code = ?').get(code.toUpperCase()) as RawRow | undefined
  return row ? rowToEvent(row) : null
}

export function createEvent(input: { name: string; description?: string; status?: 'active' | 'inactive'; isDemo?: boolean }) {
  const id = randomUUID()
  const timestamp = now()
  const event = {
    id,
    code: generateEventCode(),
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    status: input.status ?? 'active',
    config: {
      attendeePrompt: 'Join anonymously and keep the room moving.',
      showCounters: true,
    },
    isDemo: Boolean(input.isDemo),
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies EventRecord

  db.prepare(
    `
      INSERT INTO events (id, name, description, code, status, config, is_demo, created_at, updated_at)
      VALUES (@id, @name, @description, @code, @status, @config, @is_demo, @created_at, @updated_at)
    `,
  ).run({
    id: event.id,
    name: event.name,
    description: event.description,
    code: event.code,
    status: event.status,
    config: JSON.stringify(event.config),
    is_demo: event.isDemo ? 1 : 0,
    created_at: event.createdAt,
    updated_at: event.updatedAt,
  })

  return event
}

export function updateEvent(id: string, input: Partial<Pick<EventRecord, 'name' | 'description' | 'status'>> & { config?: Record<string, unknown> }) {
  const existing = getEventById(id)
  if (!existing) {
    return null
  }

  const updated: EventRecord = {
    ...existing,
    name: input.name?.trim() || existing.name,
    description: input.description?.trim() ?? existing.description,
    status: input.status ?? existing.status,
    config: input.config ?? existing.config,
    updatedAt: now(),
  }

  db.prepare(
    `
      UPDATE events
      SET name = @name, description = @description, status = @status, config = @config, updated_at = @updated_at
      WHERE id = @id
    `,
  ).run({
    id: updated.id,
    name: updated.name,
    description: updated.description,
    status: updated.status,
    config: JSON.stringify(updated.config),
    updated_at: updated.updatedAt,
  })

  return updated
}

export function listInteractions(eventId: string) {
  const rows = db
    .prepare('SELECT * FROM interactions WHERE event_id = ? ORDER BY ordering ASC, created_at ASC')
    .all(eventId) as RawRow[]
  return rows.map(rowToInteraction)
}

export function getInteraction(id: string) {
  const row = db.prepare('SELECT * FROM interactions WHERE id = ?').get(id) as RawRow | undefined
  return row ? rowToInteraction(row) : null
}

export function createInteraction(input: {
  eventId: string
  type: InteractionType
  prompt: string
  options?: string[]
  settings?: Record<string, unknown>
  status?: 'active' | 'inactive'
  ordering?: number
}) {
  const interaction: InteractionRecord = {
    id: randomUUID(),
    eventId: input.eventId,
    type: input.type,
    prompt: input.prompt.trim(),
    options: (input.options ?? []).map((option) => option.trim()).filter(Boolean),
    settings: input.settings ?? {},
    status: input.status ?? 'active',
    ordering: input.ordering ?? listInteractions(input.eventId).length + 1,
    createdAt: now(),
  }

  db.prepare(
    `
      INSERT INTO interactions (id, event_id, type, prompt, options_json, settings_json, status, ordering, created_at)
      VALUES (@id, @event_id, @type, @prompt, @options_json, @settings_json, @status, @ordering, @created_at)
    `,
  ).run({
    id: interaction.id,
    event_id: interaction.eventId,
    type: interaction.type,
    prompt: interaction.prompt,
    options_json: JSON.stringify(interaction.options),
    settings_json: JSON.stringify(interaction.settings),
    status: interaction.status,
    ordering: interaction.ordering,
    created_at: interaction.createdAt,
  })

  return interaction
}

export function updateInteraction(
  id: string,
  input: Partial<Pick<InteractionRecord, 'prompt' | 'status' | 'ordering'>> & {
    options?: string[]
    settings?: Record<string, unknown>
  },
) {
  const existing = getInteraction(id)
  if (!existing) {
    return null
  }

  const updated: InteractionRecord = {
    ...existing,
    prompt: input.prompt?.trim() || existing.prompt,
    status: input.status ?? existing.status,
    ordering: input.ordering ?? existing.ordering,
    options: input.options ? input.options.map((option) => option.trim()).filter(Boolean) : existing.options,
    settings: input.settings ?? existing.settings,
  }

  db.prepare(
    `
      UPDATE interactions
      SET prompt = @prompt, options_json = @options_json, settings_json = @settings_json, status = @status, ordering = @ordering
      WHERE id = @id
    `,
  ).run({
    id: updated.id,
    prompt: updated.prompt,
    options_json: JSON.stringify(updated.options),
    settings_json: JSON.stringify(updated.settings),
    status: updated.status,
    ordering: updated.ordering,
  })

  return updated
}

export function listResponses(eventId: string) {
  const rows = db.prepare('SELECT * FROM responses WHERE event_id = ? ORDER BY created_at DESC').all(eventId) as RawRow[]
  return rows.map(rowToResponse)
}

export function getResponse(id: string) {
  const row = db.prepare('SELECT * FROM responses WHERE id = ?').get(id) as RawRow | undefined
  return row ? rowToResponse(row) : null
}

export function createResponse(input: {
  eventId: string
  interactionId: string
  responseType: InteractionType
  content: Record<string, unknown>
  moderationState: ModerationState
}) {
  const response: ResponseRecord = {
    id: randomUUID(),
    eventId: input.eventId,
    interactionId: input.interactionId,
    responseType: input.responseType,
    content: input.content,
    moderationState: input.moderationState,
    highlighted: false,
    createdAt: now(),
  }

  db.prepare(
    `
      INSERT INTO responses (id, event_id, interaction_id, response_type, content_json, moderation_state, highlighted, created_at)
      VALUES (@id, @event_id, @interaction_id, @response_type, @content_json, @moderation_state, @highlighted, @created_at)
    `,
  ).run({
    id: response.id,
    event_id: response.eventId,
    interaction_id: response.interactionId,
    response_type: response.responseType,
    content_json: JSON.stringify(response.content),
    moderation_state: response.moderationState,
    highlighted: response.highlighted ? 1 : 0,
    created_at: response.createdAt,
  })

  return response
}

export function updateResponseModeration(id: string, moderationState: ModerationState, highlighted?: boolean) {
  const existing = getResponse(id)
  if (!existing) {
    return null
  }

  const updated: ResponseRecord = {
    ...existing,
    moderationState,
    highlighted: highlighted ?? existing.highlighted,
  }

  db.prepare(
    `
      UPDATE responses
      SET moderation_state = @moderation_state, highlighted = @highlighted
      WHERE id = @id
    `,
  ).run({
    id,
    moderation_state: updated.moderationState,
    highlighted: updated.highlighted ? 1 : 0,
  })

  return updated
}

export function createOrReplaceAnalysis(input: Omit<AnalysisRecord, 'id' | 'createdAt'>) {
  const analysis: AnalysisRecord = {
    id: randomUUID(),
    responseId: input.responseId,
    eventId: input.eventId,
    sentiment: input.sentiment,
    keywords: input.keywords,
    themes: input.themes,
    summary: input.summary,
    createdAt: now(),
  }

  db.prepare(
    `
      INSERT INTO analyses (id, response_id, event_id, sentiment, keywords_json, themes_json, summary, created_at)
      VALUES (@id, @response_id, @event_id, @sentiment, @keywords_json, @themes_json, @summary, @created_at)
      ON CONFLICT(response_id) DO UPDATE SET
        sentiment = excluded.sentiment,
        keywords_json = excluded.keywords_json,
        themes_json = excluded.themes_json,
        summary = excluded.summary,
        created_at = excluded.created_at
    `,
  ).run({
    id: analysis.id,
    response_id: analysis.responseId,
    event_id: analysis.eventId,
    sentiment: analysis.sentiment,
    keywords_json: JSON.stringify(analysis.keywords),
    themes_json: JSON.stringify(analysis.themes),
    summary: analysis.summary,
    created_at: analysis.createdAt,
  })

  return analysis
}

export function listAnalyses(eventId: string) {
  const rows = db.prepare('SELECT * FROM analyses WHERE event_id = ? ORDER BY created_at DESC').all(eventId) as RawRow[]
  return rows.map(rowToAnalysis)
}

export function ensureDemoEvent() {
  const demo = db.prepare('SELECT * FROM events WHERE is_demo = 1 LIMIT 1').get() as RawRow | undefined
  if (demo) {
    return rowToEvent(demo)
  }

  const event = createEvent({
    name: 'Future of Product Summit',
    description: 'Demo event with seeded live engagement data for presenter mode and dashboard exploration.',
    isDemo: true,
  })

  const question = createInteraction({
    eventId: event.id,
    type: 'question',
    prompt: 'What question would you like the speaker to answer next?',
  })
  const feedback = createInteraction({
    eventId: event.id,
    type: 'feedback',
    prompt: 'What did you think about this session so far?',
    ordering: 2,
  })
  const rating = createInteraction({
    eventId: event.id,
    type: 'rating',
    prompt: 'How valuable is this session?',
    settings: { scale: 5 },
    ordering: 3,
  })
  const poll = createInteraction({
    eventId: event.id,
    type: 'poll',
    prompt: 'Which topic should we cover next?',
    options: ['Implementation roadmap', 'Pricing strategy', 'AI governance', 'Customer onboarding'],
    settings: { allowMultiple: false },
    ordering: 4,
  })
  const reactions = createInteraction({
    eventId: event.id,
    type: 'reaction',
    prompt: 'How are you feeling?',
    options: ['Like', 'Interesting', 'Confused', 'Agree', 'Disagree', 'Excited'],
    ordering: 5,
  })

  const seededResponses = [
    {
      interactionId: question.id,
      responseType: 'question' as const,
      moderationState: 'visible' as const,
      content: { text: 'Can you share a realistic implementation timeline for a mid-sized team?' },
    },
    {
      interactionId: question.id,
      responseType: 'question' as const,
      moderationState: 'visible' as const,
      content: { text: 'How does pricing change as usage grows across departments?' },
    },
    {
      interactionId: question.id,
      responseType: 'question' as const,
      moderationState: 'answered' as const,
      content: { text: 'What support is available during rollout and training?' },
    },
    {
      interactionId: feedback.id,
      responseType: 'feedback' as const,
      moderationState: 'visible' as const,
      content: { text: 'Very engaging session. The examples are practical and the product feels easy to adopt.' },
    },
    {
      interactionId: feedback.id,
      responseType: 'feedback' as const,
      moderationState: 'visible' as const,
      content: { text: 'Great overview, but several of us still want more clarity around pricing and onboarding effort.' },
    },
    {
      interactionId: feedback.id,
      responseType: 'feedback' as const,
      moderationState: 'visible' as const,
      content: { text: 'The product looks promising, though implementation complexity is still a concern for my team.' },
    },
    ...[5, 4, 5, 4, 5, 4].map((value) => ({
      interactionId: rating.id,
      responseType: 'rating' as const,
      moderationState: 'visible' as const,
      content: { value },
    })),
    ...[
      'Implementation roadmap',
      'Pricing strategy',
      'Implementation roadmap',
      'Customer onboarding',
      'AI governance',
    ].map((value) => ({
      interactionId: poll.id,
      responseType: 'poll' as const,
      moderationState: 'visible' as const,
      content: { selections: [value] },
    })),
    ...[
      'Like',
      'Excited',
      'Interesting',
      'Agree',
      'Like',
      'Confused',
      'Interesting',
      'Excited',
    ].map((value) => ({
      interactionId: reactions.id,
      responseType: 'reaction' as const,
      moderationState: 'visible' as const,
      content: { value },
    })),
  ]

  for (const item of seededResponses) {
    createResponse({
      eventId: event.id,
      interactionId: item.interactionId,
      responseType: item.responseType,
      moderationState: item.moderationState,
      content: item.content,
    })
  }

  return event
}
