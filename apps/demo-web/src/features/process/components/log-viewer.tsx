'use client';

import type { LogEntry } from '../hooks/use-task-stream';

import { FileQuestion } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

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

const DOC_VALIDATION_PATTERN = 'Document type validation failed';

export function LogViewer({ logs }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lang = useBrowserLanguage();

  const hasDocValidationError = logs.some((log) =>
    log.message.includes(DOC_VALIDATION_PATTERN),
  );

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
      <CardContent className="flex h-full flex-col gap-3 pb-6">
        {hasDocValidationError && (
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <FileQuestion className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">
                {lang === 'ko'
                  ? '고고학 조사 보고서가 아닌 것으로 판단되었습니다'
                  : 'This PDF was not identified as an archaeological report'}
              </p>
              <p className="text-amber-700">
                {lang === 'ko'
                  ? 'AI가 PDF 일부를 샘플링하여 판단한 결과입니다. 실제 보고서인데 잘못 판단된 경우 다시 시도하거나, 소스코드를 내려받아 로컬에서 제한 없이 사용해 주세요.'
                  : 'This is an AI-based judgment from sampling part of the PDF. If this is incorrect, please try again or run the engine locally without restrictions.'}
              </p>
            </div>
          </div>
        )}
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
