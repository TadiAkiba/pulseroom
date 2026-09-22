import { io, type Socket } from 'socket.io-client'
import { socketUrl } from './realtime.ts'

export type SocketLifecycle = {
  socket: Socket | undefined
  cleanup: () => void
}

export function connectAdminSocket(
  eventId: string,
  onUpdate: (next: any) => void,
  onSocketEventError?: (msg: string) => void,
): SocketLifecycle {
  const socket = io(socketUrl, { transports: ['websocket'], withCredentials: true })
  socket.emit('event:join-admin', eventId)
  socket.on('event:update-admin', (nextSnapshot: any) => onUpdate(nextSnapshot))
  if (onSocketEventError) {
    socket.on('event:error', (payload: { message?: string }) =>
      onSocketEventError(payload.message ?? 'Socket admin stream refused.'),
    )
  }
  return { socket, cleanup: () => socket.disconnect() }
}

export function connectPublicSocket(
  eventId: string,
  onUpdate: (next: any) => void,
  onSocketEventError?: (msg: string) => void,
): SocketLifecycle {
  const socket = io(socketUrl, { transports: ['websocket'], withCredentials: true })
  socket.emit('event:join-public', eventId)
  socket.on('event:update-public', (nextSnapshot: any) => onUpdate(nextSnapshot))
  if (onSocketEventError) {
    socket.on('event:error', (payload: { message?: string }) =>
      onSocketEventError(payload.message ?? 'Socket public stream refused.'),
    )
  }
  return { socket, cleanup: () => socket.disconnect() }
}
