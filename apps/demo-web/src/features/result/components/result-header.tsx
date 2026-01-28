import { Download, FileJson, Loader2 } from 'lucide-react';

import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';

interface ResultHeaderProps {
  filename: string;
  isSample?: boolean;
  onExportJson: () => void;
  onDownloadAll: () => void;
  isDownloading?: boolean;
}

export function ResultHeader({
  filename,
  isSample = false,
  onExportJson,
  onDownloadAll,
  isDownloading = false,
}: ResultHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Raw Data Extraction Results
          </h1>
          {isSample && <Badge variant="sample">Sample</Badge>}
        </div>
        <p className="text-muted-foreground">{filename}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onExportJson}>
          <FileJson className="mr-2 h-4 w-4" />
          Export JSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDownloadAll}
          disabled={isDownloading}
        >
          {isDownloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          {isDownloading ? 'Downloading...' : 'Download All'}
        </Button>
      </div>
    </div>
  );
}
