import type { AuthSession, DemoMeta, EventPageData, EventSnapshot, InteractionRecord } from '../types.ts'
import type { ImportedInteraction } from './interactionImport.ts'

type FetchOptions = RequestInit & {
  json?: unknown
}

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { json, headers, ...rest } = options
  const hasJsonBody = json !== undefined
  const requestHeaders = hasJsonBody
    ? {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      }
    : headers

  const response = await fetch(path, {
    ...rest,
    credentials: 'include',
    headers: requestHeaders,
    body: hasJsonBody ? JSON.stringify(json) : rest.body,
  })

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? 'Request failed.')
  }

  return response.json() as Promise<T>
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  demo: () => request<DemoMeta>('/api/demo'),
  session: () => request<AuthSession>('/api/auth/session'),
  register: (payload: { email: string; password: string }) =>
    request<AuthSession>('/api/auth/register', { method: 'POST', json: payload }),
  login: (payload: { email: string; password: string }) =>
    request<AuthSession>('/api/auth/login', { method: 'POST', json: payload }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  listEvents: () => request<{ events: Array<EventSnapshot['event']> }>('/api/admin/events'),
  createEvent: (payload: { name: string; description?: string; status?: 'active' | 'inactive' }) =>
    request<{ event: EventSnapshot['event'] }>('/api/admin/events', { method: 'POST', json: payload }),
  getAdminEvent: (eventId: string) => request<EventSnapshot>(`/api/admin/events/${eventId}`),
  updateEvent: (eventId: string, payload: { name?: string; description?: string; status?: 'active' | 'inactive' }) =>
    request<{ event: EventSnapshot['event'] }>(`/api/admin/events/${eventId}`, { method: 'PUT', json: payload }),
  createInteraction: (eventId: string, payload: Partial<InteractionRecord> & { type: InteractionRecord['type']; prompt: string }) =>
    request<{ interaction: InteractionRecord }>(`/api/admin/events/${eventId}/interactions`, { method: 'POST', json: payload }),
  importInteractions: (eventId: string, payload: { interactions: ImportedInteraction[] }) =>
    request<{ interactions: InteractionRecord[]; importedCount: number }>(`/api/admin/events/${eventId}/interactions/import`, {
      method: 'POST',
      json: payload,
    }),
  updateInteraction: (interactionId: string, payload: Partial<InteractionRecord>) =>
    request<{ interaction: InteractionRecord }>(`/api/admin/interactions/${interactionId}`, { method: 'PUT', json: payload }),
  updateResponse: (
    responseId: string,
    payload: { moderationState?: 'pending' | 'visible' | 'hidden' | 'answered' | 'deleted'; highlighted?: boolean },
  ) => request<{ response: unknown }>(`/api/admin/responses/${responseId}`, { method: 'PATCH', json: payload }),
  getEventByCode: (code: string) => request<EventPageData>(`/api/events/code/${code}`),
  getPresenterEvent: (code: string) => request<EventSnapshot>(`/api/events/code/${code}/presenter`),
  submitResponse: (code: string, payload: Record<string, unknown>) =>
    request<{ responseId: string; message: string }>(`/api/events/code/${code}/responses`, { method: 'POST', json: payload }),
}
