'use client';

import type { LogEntry } from '../hooks/use-task-stream';

import { useEffect, useRef } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

import { formatTimestamp, getLogColor } from '../utils/log-utils';

interface LogViewerProps {
  logs: LogEntry[];
}

export function LogViewer({ logs }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Card className="h-full min-h-[40rem]">
      <CardHeader>
        <CardTitle>Processing Log</CardTitle>
        <CardDescription>Real-time processing output</CardDescription>
      </CardHeader>
      <CardContent className="flex h-full flex-col pb-6">
        <div
          ref={containerRef}
          className="bg-muted/50 max-h-[32rem] min-h-96 flex-1 overflow-auto rounded-md p-4 font-mono text-sm"
        >
          <div className="text-muted-foreground space-y-1">
            {logs.length === 0 ? (
              <p className="animate-pulse">Waiting for logs...</p>
            ) : (
              logs.map((log, index) => (
                <p key={index}>
                  <span className={getLogColor(log.level)}>
                    [{formatTimestamp(log.timestamp)}]
                  </span>{' '}
                  {log.message}
                </p>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
