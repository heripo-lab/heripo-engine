'use client';

import { Suspense, use } from 'react';

import { MobileWarningBanner } from '~/components/layout/mobile-warning-banner';
import { PipelineBreadcrumb } from '~/components/pipeline/pipeline-breadcrumb';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  ChapterContentCard,
  ChapterTree,
  ContentViewerModal,
  ContentViewerProvider,
  NextStageBanner,
  ResultError,
  ResultHeader,
  ResultLoading,
  ResultSummaryCards,
  SampleDataBanner,
  TokenUsageChart,
  useDownloadAll,
  useExportJson,
  usePageNavigation,
  useSelectedChapter,
  useTaskResult,
} from '~/features/result';

interface PageProps {
  params: Promise<{ taskId: string }>;
}

function ResultContent({ taskId }: { taskId: string }) {
  const { data, isLoading, error } = useTaskResult(taskId, {
    retryOnNotCompleted: true,
  });

  const { selectedChapterId, setSelectedChapterId } = useSelectedChapter({
    chapters: data?.result.chapters,
  });

  const { exportJson } = useExportJson({
    data: data?.result ?? null,
    filename: data?.task.originalFilename ?? 'document.pdf',
  });

  const { downloadAll, isDownloading } = useDownloadAll({
    taskId,
    filename: data?.task.originalFilename ?? 'document.pdf',
  });

  // Page navigation hook
  const pageNav = usePageNavigation({
    chapters: data?.result.chapters ?? [],
    images: data?.result.images ?? [],
    tables: data?.result.tables ?? [],
    footnotes: data?.result.footnotes ?? [],
    totalPdfPages: data?.task.totalPages ?? 0,
  });

  if (isLoading) return <ResultLoading />;
  if (error) return <ResultError message={error.message} />;
  if (!data) return null;

  const { task, result } = data;

  return (
    <ContentViewerProvider
      pageRangeMap={result.pageRangeMap}
      taskId={taskId}
      totalPages={task.totalPages ?? 0}
    >
      <div className="container mx-auto px-4 py-10 xl:px-0">
        <MobileWarningBanner />
        <div className="mx-auto max-w-7xl space-y-8">
          <PipelineBreadcrumb currentStage="raw-data" />
          <ResultHeader
            filename={task.originalFilename}
            isSample={task.isSample}
            onExportJson={exportJson}
            onDownloadAll={downloadAll}
            isDownloading={isDownloading}
          />
          {task.isSample && <SampleDataBanner />}
          <ResultSummaryCards
            pages={task.totalPages ?? 0}
            chapters={task.chaptersCount ?? 0}
            images={task.imagesCount ?? 0}
            tables={task.tablesCount ?? 0}
          />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:sticky lg:top-20 lg:col-span-1 lg:self-start">
              <Card>
                <CardHeader>
                  <CardTitle>Document Structure</CardTitle>
                  <CardDescription>Chapter hierarchy from TOC</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChapterTree
                    chapters={result.chapters}
                    selectedId={selectedChapterId}
                    onSelect={setSelectedChapterId}
                  />
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-2">
              <ChapterContentCard
                taskId={taskId}
                chapters={result.chapters}
                images={result.images}
                tables={result.tables}
                footnotes={result.footnotes ?? []}
                selectedChapterId={selectedChapterId}
                pageRangeMap={result.pageRangeMap}
                currentPage={pageNav.currentPage}
                currentPageIndex={pageNav.currentPageIndex}
                totalPages={pageNav.totalPages}
                canGoPrev={pageNav.canGoPrev}
                canGoNext={pageNav.canGoNext}
                onPrevPage={pageNav.goToPrevPage}
                onNextPage={pageNav.goToNextPage}
              />
            </div>
          </div>
          <TokenUsageChart tokenUsage={task.tokenUsage} />
          <NextStageBanner />
        </div>
      </div>
      <ContentViewerModal />
    </ContentViewerProvider>
  );
}

export default function ResultPage({ params }: PageProps) {
  const { taskId } = use(params);

  return (
    <Suspense fallback={<ResultLoading />}>
      <ResultContent taskId={taskId} />
    </Suspense>
  );
}
