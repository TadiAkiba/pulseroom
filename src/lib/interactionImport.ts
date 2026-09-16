import type { InteractionRecord } from '../types.ts'

export type ImportedInteraction = {
  type: InteractionRecord['type']
  prompt: string
  options?: string[]
  settings?: Record<string, unknown>
  status?: 'active' | 'inactive'
  ordering?: number
}

const validTypes = new Set<InteractionRecord['type']>(['question', 'feedback', 'rating', 'poll', 'reaction'])

function parseBoolean(value: string) {
  return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase())
}

function normalizeImportedInteraction(item: Record<string, unknown>, index: number): ImportedInteraction {
  const type = String(item.type ?? '').trim().toLowerCase() as InteractionRecord['type']
  if (!validTypes.has(type)) {
    throw new Error(`Row ${index + 1}: unsupported type "${String(item.type ?? '')}".`)
  }

  const prompt = String(item.prompt ?? '').trim()
  if (prompt.length < 3) {
    throw new Error(`Row ${index + 1}: prompt must be at least 3 characters.`)
  }

  const optionsValue = Array.isArray(item.options)
    ? item.options.map(String)
    : typeof item.options === 'string'
      ? item.options
          .split('|')
          .map((option) => option.trim())
          .filter(Boolean)
      : []

  const settings: Record<string, unknown> = typeof item.settings === 'object' && item.settings !== null
    ? { ...(item.settings as Record<string, unknown>) }
    : {}

  if (type === 'rating' && settings.scale === undefined && item.scale !== undefined) {
    settings.scale = Number(item.scale)
  }

  if (type === 'poll' && settings.allowMultiple === undefined && item.allowMultiple !== undefined) {
    settings.allowMultiple = typeof item.allowMultiple === 'boolean'
      ? item.allowMultiple
      : parseBoolean(String(item.allowMultiple))
  }

  if (type === 'reaction' && settings.allowMultiple === undefined) {
    delete settings.allowMultiple
  }

  const status = item.status === 'inactive' ? 'inactive' : 'active'
  const ordering = item.ordering === undefined || item.ordering === null || item.ordering === ''
    ? undefined
    : Number(item.ordering)

  return {
    type,
    prompt,
    options: type === 'poll' || type === 'reaction' ? optionsValue : [],
    settings:
      type === 'rating'
        ? { scale: Number(settings.scale ?? 5) }
        : type === 'poll'
          ? { allowMultiple: Boolean(settings.allowMultiple) }
          : {},
    status,
    ordering: Number.isFinite(ordering) ? ordering : undefined,
  }
}

function splitCsvLine(line: string) {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  values.push(current.trim())
  return values
}

function parseCsv(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    throw new Error('CSV import needs a header row and at least one interaction row.')
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim())
  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line)
    const row = Object.fromEntries(headers.map((header, valueIndex) => [header, values[valueIndex] ?? '']))
    return normalizeImportedInteraction(row, index)
  })
}

function parseJson(text: string) {
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('JSON import must contain an array of interactions.')
  }

  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Row ${index + 1}: each interaction must be an object.`)
    }
    return normalizeImportedInteraction(item as Record<string, unknown>, index)
  })
}

export async function parseInteractionFile(file: File) {
  const text = await file.text()
  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith('.json')) {
    return parseJson(text)
  }

  if (lowerName.endsWith('.csv')) {
    return parseCsv(text)
  }

  throw new Error('Use a .json or .csv file for interaction imports.')
}
