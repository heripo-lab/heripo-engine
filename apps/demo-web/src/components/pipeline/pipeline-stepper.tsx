'use client';

import { ArrowRight, Check, Lock } from 'lucide-react';

import { cn } from '~/lib/utils';

interface PipelineStage {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'disabled';
}

const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: 'raw-data',
    title: 'Raw Data Extraction',
    description: 'PDF to ProcessedDocument',
    status: 'active',
  },
  {
    id: 'ledger',
    title: 'Ledger Extraction',
    description: 'ProcessedDocument to Ledger',
    status: 'disabled',
  },
  {
    id: 'standard',
    title: 'Standard Extraction',
    description: 'Ledger to Standard',
    status: 'disabled',
  },
  {
    id: 'ontology',
    title: 'Ontology',
    description: 'Standard to Domain Ontology',
    status: 'disabled',
  },
];

interface PipelineStepperProps {
  selectedStage: string;
  onStageSelect: (stageId: string) => void;
}

export function PipelineStepper({
  selectedStage,
  onStageSelect,
}: PipelineStepperProps) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex min-w-max items-center justify-center gap-2 p-1">
        {PIPELINE_STAGES.map((stage, index) => (
          <div key={stage.id} className="flex items-center">
            <button
              type="button"
              onClick={() =>
                stage.status === 'active' && onStageSelect(stage.id)
              }
              disabled={stage.status === 'disabled'}
              className={cn(
                'relative flex flex-col items-center gap-2 rounded-lg border p-4 transition-all',
                'min-w-[140px] md:min-w-[160px]',
                stage.status === 'disabled' && 'cursor-not-allowed opacity-75',
                stage.status === 'active' &&
                  selectedStage === stage.id &&
                  'border-primary bg-primary/5 ring-primary/20 ring-2',
                stage.status === 'active' &&
                  selectedStage !== stage.id &&
                  'hover:border-primary/50 hover:bg-accent cursor-pointer',
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  stage.status === 'active' && selectedStage === stage.id
                    ? 'bg-primary text-primary-foreground'
                    : stage.status === 'active'
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-muted/70 text-muted-foreground/70',
                )}
              >
                {stage.status === 'disabled' ? (
                  <Lock className="h-4 w-4" />
                ) : selectedStage === stage.id ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span className="text-sm font-medium">{index + 1}</span>
                )}
              </div>
              <div className="text-center">
                <p
                  className={cn(
                    'text-sm font-medium',
                    stage.status === 'disabled' && 'text-muted-foreground/70',
                  )}
                >
                  {stage.title}
                </p>
                <p
                  className={cn(
                    'text-muted-foreground text-xs',
                    stage.status === 'disabled' && 'text-muted-foreground/70',
                  )}
                >
                  {stage.description}
                </p>
                {stage.status === 'disabled' && (
                  <span className="text-muted-foreground/70 mt-1 text-xs italic">
                    Coming Soon
                  </span>
                )}
              </div>
            </button>
            {index < PIPELINE_STAGES.length - 1 && (
              <ArrowRight
                className={cn(
                  'mx-2 h-5 w-5 shrink-0',
                  PIPELINE_STAGES[index + 1]?.status === 'disabled'
                    ? 'text-muted-foreground/55'
                    : 'text-muted-foreground',
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
