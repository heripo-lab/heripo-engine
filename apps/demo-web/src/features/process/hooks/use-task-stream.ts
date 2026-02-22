'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { taskKeys } from '~/lib/query-keys';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface LogEntry {
  id: number;
  level: string;
  message: string;
  timestamp: string;
}

export interface TaskStreamState {
  status: TaskStatus;
  progress: number;
  currentStep: string;
  logs: LogEntry[];
  error?: { code: string; message: string };
  resultUrl?: string;
  isConnected: boolean;
  vlmFallbackTriggered: boolean;
}

const INITIAL_STATE: TaskStreamState = {
  status: 'queued',
  progress: 0,
  currentStep: '',
  logs: [],
  isConnected: false,
  vlmFallbackTriggered: false,
};

export function useTaskStream(taskId: string | null): TaskStreamState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<TaskStreamState>(INITIAL_STATE);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!taskId) {
      setState(INITIAL_STATE);
      return;
    }

    // Reset state for new task
    setState(INITIAL_STATE);

    // Abort flag for React Strict Mode cleanup
    let isCleanedUp = false;

    const eventSource = new EventSource(`/api/tasks/${taskId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      if (isCleanedUp) return;
      setState((prev) => ({ ...prev, isConnected: true }));
    };

    eventSource.onerror = () => {
      if (isCleanedUp) return;
      setState((prev) => ({ ...prev, isConnected: false }));
      // Server handles reconnection via polling backup - no client retry needed
    };

    eventSource.addEventListener('status', (e: MessageEvent) => {
      if (isCleanedUp) return;
      const data = JSON.parse(e.data);
      setState((prev) => ({
        ...prev,
        status: data.status,
        currentStep: data.currentStep || prev.currentStep,
        progress: data.progress ?? prev.progress,
      }));
    });

    eventSource.addEventListener('progress', (e: MessageEvent) => {
      if (isCleanedUp) return;
      const data = JSON.parse(e.data);
      setState((prev) => ({
        ...prev,
        currentStep: data.step,
        progress: data.percent,
      }));
    });

    eventSource.addEventListener('log', (e: MessageEvent) => {
      if (isCleanedUp) return;
      const data = JSON.parse(e.data);
      setState((prev) => {
        // ID-based deduplication
        if (prev.logs.some((log) => log.id === data.id)) {
          return prev;
        }
        return {
          ...prev,
          logs: [...prev.logs, data],
        };
      });
    });

    eventSource.addEventListener('vlm-fallback', () => {
      if (isCleanedUp) return;
      setState((prev) => ({ ...prev, vlmFallbackTriggered: true }));
    });

    eventSource.addEventListener('complete', (e: MessageEvent) => {
      if (isCleanedUp) return;
      const data = JSON.parse(e.data);
      setState((prev) => ({
        ...prev,
        status: 'completed',
        progress: 100,
        resultUrl: data.resultUrl,
      }));

      // Invalidate React Query caches
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });

      eventSource.close();
    });

    eventSource.addEventListener('error', (e: MessageEvent) => {
      if (isCleanedUp) return;
      try {
        const data = JSON.parse(e.data);
        setState((prev) => ({
          ...prev,
          status: 'failed',
          error: data,
        }));
        eventSource.close();
      } catch {
        // SSE connection error, not our custom error event
      }
    });

    return () => {
      isCleanedUp = true;
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [taskId, queryClient]);

  return state;
}
