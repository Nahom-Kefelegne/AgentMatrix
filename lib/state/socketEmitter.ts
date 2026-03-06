import type { Server } from 'socket.io';

export function getIO(): Server | null {
  const io = (globalThis as Record<string, unknown>).__socketIO as Server | undefined;
  if (!io) {
    console.warn('[socketEmitter] Socket.IO server not available');
    return null;
  }
  return io;
}

export function emitToClients(event: string, data: unknown): void {
  const io = getIO();
  if (io) {
    io.emit(event, data);
  }
}
