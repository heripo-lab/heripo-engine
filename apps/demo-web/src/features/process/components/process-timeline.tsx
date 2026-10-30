'use client';

import { Check, Circle, Clock, Loader2, X } from 'lucide-react';

import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';
import { cn } from '~/lib/utils';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import type { TaskStatus } from '~/features/process/hooks/use-task-stream';

interface TimelineStep {
  id: string;
  title: string;
  description: string;
  /** Korean title and description, shown to Korean browsers. */
  ko?: { title: string; description: string };
  progressThreshold: number;
}

const RAW_DATA_STEPS: TimelineStep[] = [
  {
    id: 'pdf-parse',
    title: 'PDF Parsing',
    description: 'Extract content from PDF using Docling OCR',
    progressThreshold: 0,
  },
  {
    id: 'page-range',
    title: 'Page Range Mapping',
    description: 'Map PDF pages to document pages using Vision LLM',
    progressThreshold: 40,
  },
  {
    id: 'toc-extract',
    title: 'TOC Extraction',
    description: 'Find and extract table of contents structure',
    progressThreshold: 55,
  },
  {
    id: 'resource-process',
    title: 'Resource Processing',
    description: 'Extract captions for images and tables',
    progressThreshold: 65,
  },
];

const LEDGER_STEPS: TimelineStep[] = [
  {
    id: 'json-parse',
    title: 'JSON Parsing',
    description: 'Read and parse the uploaded processed-document.json',
    ko: {
      title: 'JSON 읽기',
      description: '올린 processed-document.json을 읽습니다',
    },
    progressThreshold: 0,
  },
  {
    id: 'document-validate',
    title: 'Document Validation',
    description: 'Validate the JSON against the ProcessedDocument model',
    ko: {
      title: '문서 검증',
      description: 'JSON이 ProcessedDocument 형식에 맞는지 확인합니다',
    },
    progressThreshold: 20,
  },
  {
    id: 'ledger-extract',
    title: 'Document Preview',
    description: 'Summarize the document into a ledger extraction preview',
    ko: {
      title: '문서 미리보기',
      description: '원장 추출을 위해 문서를 요약합니다',
    },
    progressThreshold: 10,
  },
  {
    id: 'report-profile',
    title: 'Report Profile',
    description: 'Classify the report and its investigation scope (1 call)',
    ko: {
      title: '보고서 유형 분류',
      description: '보고서 유형과 조사 범위를 판단합니다',
    },
    progressThreshold: 15,
  },
  {
    id: 'candidate-discovery',
    title: 'Candidate Discovery',
    description: 'Find archaeological records and review duplicates',
    ko: {
      title: '객체 후보 탐색',
      description: '고고학 객체를 찾고 중복을 검토합니다',
    },
    progressThreshold: 20,
  },
  {
    id: 'content-attachment',
    title: 'Content Attachment',
    description: 'Attach source sentences and table cells to each record',
    ko: {
      title: '원문 배정',
      description: '객체마다 원문 문장과 표 칸을 붙입니다',
    },
    progressThreshold: 45,
  },
  {
    id: 'ledger-build',
    title: 'Ledger Build',
    description: 'Parents, attributes, figures, links and validation',
    ko: {
      title: '원장 조립',
      description: '상하위, 속성, 도면·사진, 관계를 정리하고 검증합니다',
    },
    progressThreshold: 95,
  },
];

function getStepStatus(
  STEPS: TimelineStep[],
  step: TimelineStep,
  currentStep: string,
  progress: number,
): 'pending' | 'in_progress' | 'completed' | 'failed' {
  const stepIndex = STEPS.findIndex((s) => s.id === step.id);
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  if (progress >= 100) {
    return 'completed';
  }

  if (currentStep === step.id) {
    return 'in_progress';
  }

  if (currentIndex > stepIndex) {
    return 'completed';
  }

  if (progress > step.progressThreshold) {
    const nextStep = STEPS[stepIndex + 1];
    if (!nextStep || progress < nextStep.progressThreshold) {
      return 'in_progress';
    }
    return 'completed';
  }

  return 'pending';
}

interface ProcessTimelineProps {
  currentStep?: string;
  progress?: number;
  status?: TaskStatus;
  kind?: 'raw-data' | 'ledger';
}

export function ProcessTimeline({
  currentStep = '',
  progress = 0,
  status,
  kind = 'raw-data',
}: ProcessTimelineProps) {
  const lang = useBrowserLanguage();
  const STEPS = kind === 'ledger' ? LEDGER_STEPS : RAW_DATA_STEPS;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          {lang === 'ko' ? '처리 단계' : 'Processing Steps'}
        </CardTitle>
        <CardDescription>
          {lang === 'ko'
            ? '단계별 진행 상황을 확인합니다'
            : 'Track progress through each processing stage'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        <div className="space-y-4">
          {STEPS.map((step, index) => {
            let stepStatus = getStepStatus(STEPS, step, currentStep, progress);
            if (status === 'failed' && stepStatus === 'in_progress') {
              stepStatus = 'failed';
            }

            return (
              <div key={step.id} className="flex gap-4">
                {/* Status Icon */}
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full border-2',
                      stepStatus === 'completed' &&
                        'border-green-500 bg-green-500 text-white',
                      stepStatus === 'in_progress' &&
                        'border-blue-500 bg-blue-50 text-blue-500',
                      stepStatus === 'failed' &&
                        'border-red-500 bg-red-500 text-white',
                      stepStatus === 'pending' &&
                        'border-muted-foreground/25 text-muted-foreground/50',
                    )}
                  >
                    {stepStatus === 'completed' && (
                      <Check className="h-4 w-4" />
                    )}
                    {stepStatus === 'in_progress' && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {stepStatus === 'failed' && <X className="h-4 w-4" />}
                    {stepStatus === 'pending' && <Circle className="h-4 w-4" />}
                  </div>
                  {index < STEPS.length - 1 && (
                    <div
                      className={cn(
                        'min-h-[2rem] w-0.5 flex-1',
                        stepStatus === 'completed'
                          ? 'bg-green-500'
                          : 'bg-muted-foreground/25',
                      )}
                    />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-4">
                  <div className="flex items-center justify-between">
                    <h4
                      className={cn(
                        'font-medium',
                        stepStatus === 'pending' && 'text-muted-foreground',
                      )}
                    >
                      {(lang === 'ko' && step.ko?.title) || step.title}
                    </h4>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {(lang === 'ko' && step.ko?.description) ||
                      step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Timing Warning (PDF pipeline only) */}
        {kind === 'raw-data' && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              PDF OCR and parsing may take <strong>10+ minutes</strong>{' '}
              depending on document size. Please wait unless you see an error
              message or no log changes for <strong>30+ minutes</strong>.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
