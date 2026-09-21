import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from './config.ts'

export type InteractionType = 'question' | 'feedback' | 'rating' | 'poll' | 'reaction'
export type ModerationState = 'pending' | 'visible' | 'hidden' | 'answered' | 'deleted'

export type OrganizerRecord = {
  id: string
  email: string
  passwordHash: string
  createdAt: string
}

export type OrganizerSessionRecord = {
  id: string
  organizerId: string
  expiresAt: string
  createdAt: string
}

export type EventRecord = {
  id: string
  organizerId: string | null
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

export type ResponseVoteRecord = {
  id: string
  eventId: string
  responseId: string
  voterKey: string
  direction: 'up' | 'down'
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

export type OrganizerSessionLookup = {
  session: OrganizerSessionRecord
  organizer: OrganizerRecord
}

const dataPath = path.dirname(config.databasePath)
fs.mkdirSync(dataPath, { recursive: true })

export const db = new Database(config.databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

type RawRow = Record<string, unknown>

function now() {
  return new Date().toISOString()
}

function futureIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
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

function hasColumn(tableName: string, columnName: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return columns.some((column) => column.name === columnName)
}

function rowToOrganizer(row: RawRow): OrganizerRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    createdAt: String(row.created_at),
  }
}

function rowToEvent(row: RawRow): EventRecord {
  return {
    id: String(row.id),
    organizerId: row.organizer_id ? String(row.organizer_id) : null,
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

function rowToResponseVote(row: RawRow): ResponseVoteRecord {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    responseId: String(row.response_id),
    voterKey: String(row.voter_key),
    direction: String(row.direction) === 'down' ? 'down' : 'up',
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
    CREATE TABLE IF NOT EXISTS organizers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizer_sessions (
      id TEXT PRIMARY KEY,
      organizer_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organizer_id) REFERENCES organizers (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      organizer_id TEXT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      config TEXT NOT NULL DEFAULT '{}',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organizer_id) REFERENCES organizers (id) ON DELETE SET NULL
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
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
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
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
      FOREIGN KEY (interaction_id) REFERENCES interactions (id) ON DELETE CASCADE
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
      FOREIGN KEY (response_id) REFERENCES responses (id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS response_votes (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      response_id TEXT NOT NULL,
      voter_key TEXT NOT NULL,
      direction TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
      FOREIGN KEY (response_id) REFERENCES responses (id) ON DELETE CASCADE,
      UNIQUE(response_id, voter_key)
    );

    CREATE TABLE IF NOT EXISTS convex_sync_state (
      event_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_retry_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
    );
  `)

  if (!hasColumn('events', 'organizer_id')) {
    db.exec('ALTER TABLE events ADD COLUMN organizer_id TEXT REFERENCES organizers(id) ON DELETE SET NULL')
  }
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

export function countOrganizers() {
  const row = db.prepare('SELECT COUNT(*) as count FROM organizers').get() as { count: number }
  return Number(row.count)
}

export function getOrganizerByEmail(email: string) {
  const row = db.prepare('SELECT * FROM organizers WHERE email = ?').get(email.toLowerCase()) as RawRow | undefined
  return row ? rowToOrganizer(row) : null
}

export function createOrganizer(input: { email: string; passwordHash: string }) {
  const organizer: OrganizerRecord = {
    id: randomUUID(),
    email: input.email.trim().toLowerCase(),
    passwordHash: input.passwordHash,
    createdAt: now(),
  }

  db.prepare(
    `
      INSERT INTO organizers (id, email, password_hash, created_at)
      VALUES (@id, @email, @password_hash, @created_at)
    `,
  ).run({
    id: organizer.id,
    email: organizer.email,
    password_hash: organizer.passwordHash,
    created_at: organizer.createdAt,
  })

  return organizer
}

export function updateOrganizerPassword(id: string, passwordHash: string) {
  db.prepare('UPDATE organizers SET password_hash = ? WHERE id = ?').run(passwordHash, id)
  return getOrganizerById(id)
}

export function getOrganizerById(id: string) {
  const row = db.prepare('SELECT * FROM organizers WHERE id = ?').get(id) as RawRow | undefined
  return row ? rowToOrganizer(row) : null
}

export function createOrganizerSession(organizerId: string) {
  const session: OrganizerSessionRecord = {
    id: randomUUID(),
    organizerId,
    expiresAt: futureIso(config.sessionTtlHours),
    createdAt: now(),
  }

  db.prepare(
    `
      INSERT INTO organizer_sessions (id, organizer_id, expires_at, created_at)
      VALUES (@id, @organizer_id, @expires_at, @created_at)
    `,
  ).run({
    id: session.id,
    organizer_id: session.organizerId,
    expires_at: session.expiresAt,
    created_at: session.createdAt,
  })

  return session
}

export function deleteExpiredSessions() {
  db.prepare('DELETE FROM organizer_sessions WHERE expires_at <= ?').run(now())
}

export function getOrganizerSession(sessionId: string) {
  deleteExpiredSessions()
  const row = db
    .prepare(
      `
        SELECT
          s.id as session_id,
          s.organizer_id as session_organizer_id,
          s.expires_at,
          s.created_at as session_created_at,
          o.id,
          o.email,
          o.password_hash,
          o.created_at
        FROM organizer_sessions s
        JOIN organizers o ON o.id = s.organizer_id
        WHERE s.id = ?
      `,
    )
    .get(sessionId) as RawRow | undefined

  if (!row) {
    return null
  }

  return {
    session: {
      id: String(row.session_id),
      organizerId: String(row.session_organizer_id),
      expiresAt: String(row.expires_at),
      createdAt: String(row.session_created_at),
    },
    organizer: rowToOrganizer(row),
  } satisfies OrganizerSessionLookup
}

export function deleteOrganizerSession(sessionId: string) {
  db.prepare('DELETE FROM organizer_sessions WHERE id = ?').run(sessionId)
}

export function listEvents() {
  const rows = db.prepare('SELECT * FROM events ORDER BY created_at DESC').all() as RawRow[]
  return rows.map(rowToEvent)
}

export function listEventsForOrganizer(organizerId: string) {
  const rows = db
    .prepare(
      `
        SELECT * FROM events
        WHERE organizer_id = ? OR is_demo = 1
        ORDER BY created_at DESC
      `,
    )
    .all(organizerId) as RawRow[]
  return rows.map(rowToEvent)
}

export function getEventById(id: string) {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as RawRow | undefined
  return row ? rowToEvent(row) : null
}

export function getManageableEventById(id: string, organizerId: string) {
  const row = db
    .prepare('SELECT * FROM events WHERE id = ? AND (organizer_id = ? OR is_demo = 1)')
    .get(id, organizerId) as RawRow | undefined
  return row ? rowToEvent(row) : null
}

export function getEventByCode(code: string) {
  const row = db.prepare('SELECT * FROM events WHERE code = ?').get(code.toUpperCase()) as RawRow | undefined
  return row ? rowToEvent(row) : null
}

export function createEvent(input: {
  organizerId: string | null
  name: string
  description?: string
  status?: 'active' | 'inactive'
  isDemo?: boolean
}) {
  const id = randomUUID()
  const timestamp = now()
  const event = {
    id,
    organizerId: input.organizerId,
    code: generateEventCode(),
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    status: input.status ?? 'active',
    config: {
      attendeePrompt: 'Join the AI townhall, choose an anonymous nickname, and help shape the next move.',
      showCounters: true,
      teams: ['Catalysts', 'Builders', 'Navigators', 'Trailblazers'],
    },
    isDemo: Boolean(input.isDemo),
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies EventRecord

  db.prepare(
    `
      INSERT INTO events (id, organizer_id, name, description, code, status, config, is_demo, created_at, updated_at)
      VALUES (@id, @organizer_id, @name, @description, @code, @status, @config, @is_demo, @created_at, @updated_at)
    `,
  ).run({
    id: event.id,
    organizer_id: event.organizerId,
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

export function updateEvent(
  id: string,
  input: Partial<Pick<EventRecord, 'name' | 'description' | 'status'>> & { config?: Record<string, unknown> },
) {
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
  const rows = db
    .prepare('SELECT * FROM responses WHERE event_id = ? ORDER BY created_at DESC')
    .all(eventId) as RawRow[]
  return rows.map(rowToResponse)
}

export function listResponseVotes(eventId: string) {
  const rows = db
    .prepare('SELECT * FROM response_votes WHERE event_id = ? ORDER BY created_at DESC')
    .all(eventId) as RawRow[]
  return rows.map(rowToResponseVote)
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

export function upsertResponseVote(input: {
  eventId: string
  responseId: string
  voterKey: string
  direction: 'up' | 'down'
}) {
  const existing = db
    .prepare('SELECT * FROM response_votes WHERE response_id = ? AND voter_key = ?')
    .get(input.responseId, input.voterKey) as RawRow | undefined

  if (existing) {
    const updated = {
      ...rowToResponseVote(existing),
      direction: input.direction,
      createdAt: now(),
    } satisfies ResponseVoteRecord

    db.prepare(
      `
        UPDATE response_votes
        SET direction = @direction, created_at = @created_at
        WHERE id = @id
      `,
    ).run({
      id: updated.id,
      direction: updated.direction,
      created_at: updated.createdAt,
    })

    return updated
  }

  const vote: ResponseVoteRecord = {
    id: randomUUID(),
    eventId: input.eventId,
    responseId: input.responseId,
    voterKey: input.voterKey,
    direction: input.direction,
    createdAt: now(),
  }

  db.prepare(
    `
      INSERT INTO response_votes (id, event_id, response_id, voter_key, direction, created_at)
      VALUES (@id, @event_id, @response_id, @voter_key, @direction, @created_at)
    `,
  ).run({
    id: vote.id,
    event_id: vote.eventId,
    response_id: vote.responseId,
    voter_key: vote.voterKey,
    direction: vote.direction,
    created_at: vote.createdAt,
  })

  return vote
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
  const rows = db
    .prepare('SELECT * FROM analyses WHERE event_id = ? ORDER BY created_at DESC')
    .all(eventId) as RawRow[]
  return rows.map(rowToAnalysis)
}

export function ensureDemoEvent(organizerId?: string) {
  const demo = db.prepare('SELECT * FROM events WHERE is_demo = 1 LIMIT 1').get() as RawRow | undefined
  if (demo) {
    return rowToEvent(demo)
  }

  const event = createEvent({
    organizerId: organizerId ?? null,
    name: 'Future of Product Summit',
    description: 'Demo event with seeded live engagement data for presenter mode and dashboard exploration.',
    isDemo: true,
  })

  const ideaText = createInteraction({
    eventId: event.id,
    type: 'feedback',
    prompt: 'What is your AI idea?',
    settings: {
      formKey: 'idea',
      formTitle: 'AI Idea',
      formDescription: 'Tell us in your own words.',
      questionNumber: 1,
      questionCount: 5,
      points: 10,
      feedEligible: true,
    },
  })
  const ideaImprove = createInteraction({
    eventId: event.id,
    type: 'poll',
    prompt: 'What would this improve?',
    options: ['Customer experience', 'Employee experience', 'Productivity', 'Cost / efficiency', 'Revenue / growth'],
    settings: { formKey: 'idea', formTitle: 'AI Idea', questionNumber: 2, questionCount: 5, allowMultiple: true, points: 2 },
    ordering: 2,
  })
  const ideaBenefit = createInteraction({
    eventId: event.id,
    type: 'poll',
    prompt: 'Who would benefit most?',
    options: ['Customers', 'Employees', 'Managers', 'The business', 'Everyone'],
    settings: { formKey: 'idea', formTitle: 'AI Idea', questionNumber: 3, questionCount: 5, allowMultiple: false, points: 2 },
    ordering: 3,
  })
  const ideaValue = createInteraction({
    eventId: event.id,
    type: 'rating',
    prompt: 'How valuable do you think this could be?',
    settings: { formKey: 'idea', formTitle: 'AI Idea', questionNumber: 4, questionCount: 5, scale: 4, labels: ['Low', 'Medium', 'High', 'Game-changing'], points: 3 },
    ordering: 4,
  })
  const ideaEase = createInteraction({
    eventId: event.id,
    type: 'poll',
    prompt: 'How easy do you think it would be to implement?',
    options: ['Easy', 'Moderate', 'Difficult', 'Not sure'],
    settings: { formKey: 'idea', formTitle: 'AI Idea', questionNumber: 5, questionCount: 5, allowMultiple: false, points: 2 },
    ordering: 5,
  })
  const opportunityWhere = createInteraction({
    eventId: event.id,
    type: 'feedback',
    prompt: 'Where do you see an opportunity for AI?',
    settings: { formKey: 'opportunity', formTitle: 'AI Opportunity', questionNumber: 1, questionCount: 5, points: 8, feedEligible: true },
    ordering: 6,
  })
  const opportunityProblem = createInteraction({
    eventId: event.id,
    type: 'feedback',
    prompt: 'What problem could AI solve?',
    settings: { formKey: 'opportunity', formTitle: 'AI Opportunity', questionNumber: 2, questionCount: 5, points: 6, feedEligible: true },
    ordering: 7,
  })
  const opportunityFrequency = createInteraction({
    eventId: event.id,
    type: 'poll',
    prompt: 'How often does this problem occur?',
    options: ['Daily', 'Weekly', 'Monthly', 'Occasionally'],
    settings: { formKey: 'opportunity', formTitle: 'AI Opportunity', questionNumber: 3, questionCount: 5, allowMultiple: false, points: 2 },
    ordering: 8,
  })
  const opportunityImpact = createInteraction({
    eventId: event.id,
    type: 'poll',
    prompt: 'What would the impact be?',
    options: ['Save time', 'Reduce costs', 'Improve quality', 'Improve customer experience', 'Increase revenue', 'Reduce risk'],
    settings: { formKey: 'opportunity', formTitle: 'AI Opportunity', questionNumber: 4, questionCount: 5, allowMultiple: false, points: 2 },
    ordering: 9,
  })
  const opportunityExcitement = createInteraction({
    eventId: event.id,
    type: 'rating',
    prompt: 'How excited are you about this opportunity?',
    settings: { formKey: 'opportunity', formTitle: 'AI Opportunity', questionNumber: 5, questionCount: 5, scale: 4, labels: ['Not yet', 'Curious', 'Excited', 'Very excited'], points: 2 },
    ordering: 10,
  })
  const concernTheme = createInteraction({
    eventId: event.id,
    type: 'poll',
    prompt: 'What concerns you most about AI?',
    options: ['Job security', 'Privacy', 'Data security', 'Incorrect information', 'Bias / unfair decisions', 'Loss of human interaction', 'Lack of understanding', 'Too much change'],
    settings: { formKey: 'concern', formTitle: 'AI Concern', formDescription: 'There are no wrong answers. Your response is anonymous.', questionNumber: 1, questionCount: 4, allowMultiple: false, points: 3 },
    ordering: 11,
  })
  const concernDetail = createInteraction({
    eventId: event.id,
    type: 'feedback',
    prompt: 'Tell us more.',
    settings: { formKey: 'concern', formTitle: 'AI Concern', questionNumber: 2, questionCount: 4, points: 4, feedEligible: false },
    ordering: 12,
  })
  const concernLevel = createInteraction({
    eventId: event.id,
    type: 'rating',
    prompt: 'How concerned are you?',
    settings: { formKey: 'concern', formTitle: 'AI Concern', questionNumber: 3, questionCount: 4, scale: 4, labels: ['Not concerned', 'Slightly concerned', 'Concerned', 'Very concerned'], points: 2 },
    ordering: 13,
  })
  const concernAction = createInteraction({
    eventId: event.id,
    type: 'feedback',
    prompt: 'What would make you feel more comfortable with AI?',
    settings: { formKey: 'concern', formTitle: 'AI Concern', questionNumber: 4, questionCount: 4, points: 6, feedEligible: false, helperText: 'This is especially useful because it turns fear into action.' },
    ordering: 14,
  })

  const seededResponses = [
    {
      interactionId: ideaText.id,
      responseType: 'feedback' as const,
      moderationState: 'visible' as const,
      content: { text: 'Use AI to draft customer follow-up emails from CRM notes.', attendeeKey: 'demo-1', nickname: 'BrightNova42', team: 'Catalysts' },
    },
    {
      interactionId: ideaText.id,
      responseType: 'feedback' as const,
      moderationState: 'visible' as const,
      content: { text: 'Give managers an AI co-pilot to summarize delivery risks before weekly reviews.', attendeeKey: 'demo-2', nickname: 'SignalPulse58', team: 'Builders' },
    },
    {
      interactionId: opportunityWhere.id,
      responseType: 'feedback' as const,
      moderationState: 'visible' as const,
      content: { text: 'AI could help service teams spot repeat complaints before churn spikes.', attendeeKey: 'demo-3', nickname: 'CuriousEcho21', team: 'Navigators' },
    },
    {
      interactionId: opportunityProblem.id,
      responseType: 'feedback' as const,
      moderationState: 'visible' as const,
      content: { text: 'We lose hours each week searching for answers across scattered docs and chats.', attendeeKey: 'demo-4', nickname: 'BoldVector33', team: 'Trailblazers' },
    },
    {
      interactionId: concernDetail.id,
      responseType: 'feedback' as const,
      moderationState: 'visible' as const,
      content: { text: 'I worry teams will over-trust generated answers without enough review.', attendeeKey: 'demo-5', nickname: 'CalmBeacon67', team: 'Builders' },
    },
    {
      interactionId: concernAction.id,
      responseType: 'feedback' as const,
      moderationState: 'visible' as const,
      content: { text: 'Show us clear governance rules and examples of when human approval is required.', attendeeKey: 'demo-6', nickname: 'SharpOrbit74', team: 'Navigators' },
    },
    ...[ideaValue.id, opportunityExcitement.id, concernLevel.id].flatMap((interactionId, index) =>
      [4, 3, 4].map((value, offset) => ({
        interactionId,
        responseType: 'rating' as const,
        moderationState: 'visible' as const,
        content: {
          value: Math.max(1, Math.min(4, value - (index === 1 ? offset % 2 : 0))),
          attendeeKey: `demo-rating-${interactionId}-${offset}`,
          nickname: `DemoRating${index}${offset}`,
          team: ['Catalysts', 'Builders', 'Navigators', 'Trailblazers'][offset % 4],
        },
      })),
    ),
    ...[
      { interactionId: ideaImprove.id, selections: ['Productivity', 'Customer experience'], team: 'Catalysts' },
      { interactionId: ideaBenefit.id, selections: ['Employees'], team: 'Builders' },
      { interactionId: ideaEase.id, selections: ['Moderate'], team: 'Builders' },
      { interactionId: opportunityFrequency.id, selections: ['Weekly'], team: 'Navigators' },
      { interactionId: opportunityImpact.id, selections: ['Save time'], team: 'Navigators' },
      { interactionId: concernTheme.id, selections: ['Data security'], team: 'Trailblazers' },
    ].map((item, index) => ({
      interactionId: item.interactionId,
      responseType: 'poll' as const,
      moderationState: 'visible' as const,
      content: {
        selections: item.selections,
        attendeeKey: `demo-poll-${index}`,
        nickname: `DemoPoll${index}`,
        team: item.team,
      },
    })),
    ...[0, 1, 2].map((_, index) => ({
      interactionId: concernLevel.id,
      responseType: 'rating' as const,
      moderationState: 'visible' as const,
      content: {
        value: Math.min(4, index + 2),
        attendeeKey: `demo-concern-rating-${index}`,
        nickname: `ConcernDemo${index}`,
        team: ['Catalysts', 'Builders', 'Trailblazers'][index],
      },
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

  return getEventById(event.id)
}

export function touchConvexSyncState(eventId: string, updatedAt: string) {
  db.prepare(
    `
      INSERT INTO convex_sync_state (event_id, updated_at, tries, last_error, next_retry_at)
      VALUES (@eventId, @updatedAt, 0, NULL, @updatedAt)
      ON CONFLICT(event_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        tries = CASE WHEN convex_sync_state.tries = 0 THEN 0 ELSE convex_sync_state.tries END,
        last_error = CASE WHEN convex_sync_state.tries = 0 THEN NULL ELSE convex_sync_state.last_error END,
        next_retry_at = CASE WHEN convex_sync_state.tries = 0 THEN excluded.next_retry_at ELSE convex_sync_state.next_retry_at END
    `,
  ).run({ eventId, updatedAt })
}

export function markConvexSyncSuccess(eventId: string) {
  db.prepare(
    'DELETE FROM convex_sync_state WHERE event_id = ?',
  ).run(eventId)
}

export function markConvexSyncFailure(eventId: string, error: string, nextRetryAt: string) {
  db.prepare(
    `
      UPDATE convex_sync_state
      SET tries = tries + 1,
          last_error = ?,
          next_retry_at = ?
      WHERE event_id = ?
    `,
  ).run(error, nextRetryAt, eventId)
}

export function listConvexSyncFailures() {
  const rows = db
    .prepare('SELECT * FROM convex_sync_state WHERE tries > 0 ORDER BY next_retry_at ASC')
    .all() as Array<{
      event_id: string
      updated_at: string
      tries: number
      last_error: string | null
      next_retry_at: string
    }>
  return rows.map((row) => ({
    eventId: row.event_id,
    updatedAt: row.updated_at,
    tries: Number(row.tries),
    lastError: row.last_error,
    nextRetryAt: row.next_retry_at,
  }))
}
