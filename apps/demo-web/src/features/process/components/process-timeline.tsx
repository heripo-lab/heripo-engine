'use client';

import { Check, Circle, Clock, Loader2, X } from 'lucide-react';

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
  progressThreshold: number;
}

const STEPS: TimelineStep[] = [
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

function getStepStatus(
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
}

export function ProcessTimeline({
  currentStep = '',
  progress = 0,
  status,
}: ProcessTimelineProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Processing Steps</CardTitle>
        <CardDescription>
          Track progress through each processing stage
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        <div className="space-y-4">
          {STEPS.map((step, index) => {
            let stepStatus = getStepStatus(step, currentStep, progress);
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
                      {step.title}
                    </h4>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Timing Warning */}
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            PDF OCR and parsing may take <strong>10+ minutes</strong> depending
            on document size. Please wait unless you see an error message or no
            log changes for <strong>30+ minutes</strong>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
