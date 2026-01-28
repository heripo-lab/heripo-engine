import { ChevronRight } from 'lucide-react';

type PipelineStage = 'raw-data' | 'ledger' | 'standard' | 'ontology';

interface PipelineBreadcrumbProps {
  currentStage: PipelineStage;
}

const stages: { id: PipelineStage; label: string }[] = [
  { id: 'raw-data', label: 'Raw Data Extraction' },
  { id: 'ledger', label: 'Ledger Extraction' },
  { id: 'standard', label: 'Standard Extraction' },
  { id: 'ontology', label: 'Ontology' },
];

export function PipelineBreadcrumb({ currentStage }: PipelineBreadcrumbProps) {
  const currentIndex = stages.findIndex((s) => s.id === currentStage);

  return (
    <div className="text-muted-foreground flex items-center gap-1 text-sm">
      {stages.map((stage, index) => {
        const isCurrent = stage.id === currentStage;
        const isPast = index < currentIndex;
        const isFuture = index > currentIndex;

        return (
          <span key={stage.id} className="flex items-center gap-1">
            <span
              className={
                isCurrent
                  ? 'text-foreground font-medium'
                  : isPast
                    ? 'text-foreground'
                    : 'opacity-50'
              }
            >
              {stage.label}
            </span>
            {index < stages.length - 1 && (
              <ChevronRight
                className={`h-4 w-4 ${isFuture ? 'opacity-50' : ''}`}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}
