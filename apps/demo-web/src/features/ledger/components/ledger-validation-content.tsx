'use client';

import {
  ChevronDown,
  ChevronRight,
  Download,
  FileJson,
  FileText,
  Image as ImageIcon,
  ListOrdered,
  StickyNote,
  Table as TableIcon,
} from 'lucide-react';
import { useState } from 'react';

import type { LedgerTaskResultResponse } from '~/lib/api/tasks';

import { MobileWarningBanner } from '~/components/layout/mobile-warning-banner';
import { PipelineBreadcrumb } from '~/components/pipeline/pipeline-breadcrumb';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

import { LedgerPreviewImage } from './ledger-preview-image';

interface MetricCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
}

function MetricCard({ title, value, icon }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

interface LedgerValidationContentProps {
  data: LedgerTaskResultResponse;
}

/**
 * Temporary preprocessed document validation view.
 *
 * Confirms that an uploaded processed-document.json was delivered intact to
 * the ledger extraction stage by rendering the LedgerExtractionPreview
 * (counts, samples, raw JSON). This is NOT the ledger result page — that
 * page has not been designed yet and is only a titled placeholder.
 */
export function LedgerValidationContent({
  data,
}: LedgerValidationContentProps) {
  const [rawJsonExpanded, setRawJsonExpanded] = useState(false);
  const { task, result } = data;
  const { counts, samples } = result;

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${task.originalFilename.replace(/\.json$/i, '')}-ledger-validation.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto px-4 py-10 xl:px-0">
      <MobileWarningBanner />
      <div className="mx-auto max-w-7xl space-y-8">
        <PipelineBreadcrumb currentStage="ledger" />

        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Preprocessed Document Validation
            </h1>
            <p className="text-muted-foreground mt-1">
              {task.originalFilename} · reportId:{' '}
              <span className="font-mono">{result.reportId}</span> · schema:{' '}
              <span className="font-mono">
                {result.schemaVersion ?? 'unknown'}
              </span>
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Temporary view to confirm the uploaded processed-document.json was
              delivered intact. The ledger extraction result page is still being
              designed.
            </p>
          </div>
          <Button variant="outline" onClick={handleExportJson}>
            <Download className="mr-2 h-4 w-4" />
            Export Validation JSON
          </Button>
        </div>

        {/* Counts */}
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            title="Chapters"
            value={counts.chapters}
            icon={<ListOrdered className="text-muted-foreground h-4 w-4" />}
          />
          <MetricCard
            title="Text Blocks"
            value={counts.textBlocks}
            icon={<FileText className="text-muted-foreground h-4 w-4" />}
          />
          <MetricCard
            title="Images"
            value={counts.images}
            icon={<ImageIcon className="text-muted-foreground h-4 w-4" />}
          />
          <MetricCard
            title="Tables"
            value={counts.tables}
            icon={<TableIcon className="text-muted-foreground h-4 w-4" />}
          />
          <MetricCard
            title="Table Cells"
            value={counts.tableCells}
            icon={<TableIcon className="text-muted-foreground h-4 w-4" />}
          />
          <MetricCard
            title="Footnotes"
            value={counts.footnotes}
            icon={<StickyNote className="text-muted-foreground h-4 w-4" />}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Sample chapter titles */}
          <Card>
            <CardHeader>
              <CardTitle>Sample Chapter Titles</CardTitle>
              <CardDescription>
                First chapters in depth-first order
              </CardDescription>
            </CardHeader>
            <CardContent>
              {samples.chapterTitles.length === 0 ? (
                <p className="text-muted-foreground text-sm">No chapters</p>
              ) : (
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {samples.chapterTitles.map((title, index) => (
                    <li key={`${index}-${title}`}>{title}</li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Sample text blocks */}
          <Card>
            <CardHeader>
              <CardTitle>Sample Text Blocks</CardTitle>
              <CardDescription>
                Truncated excerpts with chapter and page references
              </CardDescription>
            </CardHeader>
            <CardContent>
              {samples.textBlocks.length === 0 ? (
                <p className="text-muted-foreground text-sm">No text blocks</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {samples.textBlocks.map((block, index) => (
                    <li
                      key={`${block.chapterId}-${index}`}
                      className="rounded-md border p-3"
                    >
                      <p>{block.text}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        chapter: {block.chapterId} · PDF page {block.pdfPageNo}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sample images */}
        <Card>
          <CardHeader>
            <CardTitle>Sample Images</CardTitle>
            <CardDescription>
              Image URLs are consumed as-is from ProcessedImage.path (public CDN
              URLs)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {samples.images.length === 0 ? (
              <p className="text-muted-foreground text-sm">No images</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {samples.images.map((image) => (
                  <LedgerPreviewImage
                    key={image.id}
                    id={image.id}
                    pdfPageNo={image.pdfPageNo}
                    url={image.url}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sample tables */}
        <Card>
          <CardHeader>
            <CardTitle>Sample Tables</CardTitle>
            <CardDescription>Caption and grid dimensions</CardDescription>
          </CardHeader>
          <CardContent>
            {samples.tables.length === 0 ? (
              <p className="text-muted-foreground text-sm">No tables</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {samples.tables.map((table) => (
                  <li
                    key={table.id}
                    className="flex flex-col gap-1 rounded-md border p-3 md:flex-row md:items-center md:justify-between"
                  >
                    <span>
                      <span className="font-medium">{table.id}</span>{' '}
                      <span className="text-muted-foreground">
                        {table.caption ?? 'No caption'}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {table.numRows} rows × {table.numCols} cols · PDF page{' '}
                      {table.pdfPageNo}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Raw preview JSON (collapsible) */}
        <Card>
          <CardHeader>
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
              onClick={() => setRawJsonExpanded((expanded) => !expanded)}
            >
              {rawJsonExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <FileJson className="h-4 w-4" />
              <CardTitle className="text-base">Raw Preview JSON</CardTitle>
            </button>
          </CardHeader>
          {rawJsonExpanded && (
            <CardContent>
              <pre className="bg-muted/50 max-h-96 overflow-auto rounded-md p-4 text-xs">
                {JSON.stringify(result, null, 2)}
              </pre>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
