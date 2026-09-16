import type { EventPageData, EventSnapshot, InteractionRecord } from '../types.ts'

type FetchOptions = RequestInit & {
  json?: unknown
}

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { json, headers, ...rest } = options

  const response = await fetch(path, {
    ...rest,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  })

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? 'Request failed.')
  }

  return response.json() as Promise<T>
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  demo: () => request<{ demoCode: string | null }>('/api/demo'),
  session: () => request<{ authenticated: boolean }>('/api/auth/session'),
  login: (passcode: string) => request<{ authenticated: boolean }>('/api/auth/login', { method: 'POST', json: { passcode } }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  listEvents: () => request<{ events: Array<EventSnapshot['event']> }>('/api/admin/events'),
  createEvent: (payload: { name: string; description?: string; status?: 'active' | 'inactive' }) =>
    request<{ event: EventSnapshot['event'] }>('/api/admin/events', { method: 'POST', json: payload }),
  getAdminEvent: (eventId: string) => request<EventSnapshot>(`/api/admin/events/${eventId}`),
  updateEvent: (eventId: string, payload: { name?: string; description?: string; status?: 'active' | 'inactive' }) =>
    request<{ event: EventSnapshot['event'] }>(`/api/admin/events/${eventId}`, { method: 'PUT', json: payload }),
  createInteraction: (eventId: string, payload: Partial<InteractionRecord> & { type: InteractionRecord['type']; prompt: string }) =>
    request<{ interaction: InteractionRecord }>(`/api/admin/events/${eventId}/interactions`, { method: 'POST', json: payload }),
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
