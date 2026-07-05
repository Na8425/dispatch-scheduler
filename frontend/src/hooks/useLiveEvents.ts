import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';

export interface LiveEvent {
  event: string;
  payload: Record<string, any>;
  ts: string;
}

/**
 * Subscribes the dashboard to a project's live event stream over WebSocket.
 * Rather than manually patching local state per event type, we simply
 * invalidate the relevant React Query cache keys on any event touching
 * jobs/queues/workers — React Query then refetches in the background.
 * This trades a little extra network traffic for a lot less bug surface
 * than hand-rolling optimistic cache updates for every event shape.
 *
 * Falls back gracefully: if the socket never connects (e.g. WS blocked by
 * a corporate proxy), each page's own polling (refetchInterval) keeps data
 * fresh regardless — live updates are a UX enhancement, not a dependency.
 */
export function useLiveEvents(projectId: string | null, onEvent?: (e: LiveEvent) => void) {
  const queryClient = useQueryClient();
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!projectId || !token) return;

    const socketUrl = import.meta.env.VITE_API_URL ?? '/';
    const socket = io(socketUrl, { auth: { token }, path: '/socket.io' });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('subscribe:project', projectId);
    });

    socket.on('event', (e: LiveEvent) => {
      onEvent?.(e);
      if (e.event.startsWith('job.') || e.event.startsWith('batch.')) {
        queryClient.invalidateQueries({ queryKey: ['jobs'] });
        queryClient.invalidateQueries({ queryKey: ['queueStats'] });
        queryClient.invalidateQueries({ queryKey: ['projectHealth'] });
        queryClient.invalidateQueries({ queryKey: ['throughput'] });
        queryClient.invalidateQueries({ queryKey: ['deadLetter'] });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [projectId, token, queryClient, onEvent]);
}
