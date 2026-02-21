'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { use, useState } from 'react';

import { MobileWarningBanner } from '~/components/layout/mobile-warning-banner';
import { PipelineBreadcrumb } from '~/components/pipeline/pipeline-breadcrumb';
import { ConfirmDialog } from '~/components/ui/confirm-dialog';
import { Progress } from '~/components/ui/progress';
import {
  LogViewer,
  ProcessErrorAlert,
  ProcessErrorDialog,
  ProcessHeader,
  ProcessInfoCard,
  ProcessTimeline,
  useAutoNavigate,
  useTask,
  useTaskStream,
} from '~/features/process';
import { useDeleteTask } from '~/features/tasks';

interface PageProps {
  params: Promise<{ taskId: string }>;
}

export default function ProcessPage({ params }: PageProps) {
  const { taskId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const deleteTaskMutation = useDeleteTask();
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const disableAutoNavigate = searchParams.get('stay') === 'true';

  const { data: task } = useTask(taskId);
  const { status, progress, currentStep, logs, error, resultUrl } =
    useTaskStream(taskId);
  const isProcessing = status === 'queued' || status === 'running';

  useAutoNavigate({ status, resultUrl, taskId, disabled: disableAutoNavigate });

  const handleCancelClick = () => {
    setShowCancelDialog(true);
  };

  const handleConfirmCancel = () => {
    deleteTaskMutation.mutate(taskId, {
      onSuccess: () => {
        setShowCancelDialog(false);
        router.push('/tasks');
      },
    });
  };

  const filename = task?.originalFilename ?? 'document.pdf';

  return (
    <div className="container mx-auto px-4 py-10 xl:px-0">
      <MobileWarningBanner />
      <div className="mx-auto max-w-7xl space-y-8">
        <PipelineBreadcrumb currentStage="raw-data" />
        <ProcessHeader
          status={status}
          filename={filename}
          onCancel={handleCancelClick}
          isCancelling={deleteTaskMutation.isPending}
        />
        {isProcessing && <Progress value={progress} indeterminate />}
        <ProcessErrorAlert error={error} />
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="w-full lg:w-2/5">
            <ProcessTimeline
              currentStep={currentStep}
              progress={progress}
              status={status}
            />
          </div>
          <div className="w-full lg:w-3/5">
            <LogViewer logs={logs} />
          </div>
        </div>
        <ProcessInfoCard />

        <ProcessErrorDialog
          open={status === 'failed'}
          onOpenChange={() => {}}
          error={error}
        />

        <ConfirmDialog
          open={showCancelDialog}
          onOpenChange={setShowCancelDialog}
          onConfirm={handleConfirmCancel}
          title="Cancel Processing"
          description="Are you sure you want to cancel this task? This action cannot be undone and all progress will be lost."
          confirmText="Cancel Task"
          cancelText="Continue Processing"
          variant="destructive"
          isPending={deleteTaskMutation.isPending}
        />
      </div>
    </div>
  );
}
