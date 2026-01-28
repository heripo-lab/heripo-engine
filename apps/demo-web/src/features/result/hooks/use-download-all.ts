'use client';

import { useCallback, useState } from 'react';

import { downloadTaskZip } from '~/lib/api/tasks';

interface UseDownloadAllOptions {
  taskId: string;
  filename: string;
}

interface UseDownloadAllResult {
  downloadAll: () => Promise<void>;
  isDownloading: boolean;
  error: Error | null;
}

/**
 * Hook for downloading all task results as a ZIP file.
 */
export function useDownloadAll({
  taskId,
  filename,
}: UseDownloadAllOptions): UseDownloadAllResult {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const downloadAll = useCallback(async () => {
    if (isDownloading) return;

    setIsDownloading(true);
    setError(null);

    try {
      const blob = await downloadTaskZip(taskId);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename.replace('.pdf', '')}-all.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const downloadError =
        err instanceof Error ? err : new Error('Download failed');
      setError(downloadError);
      console.error('Download failed:', downloadError);
    } finally {
      setIsDownloading(false);
    }
  }, [taskId, filename, isDownloading]);

  return { downloadAll, isDownloading, error };
}
