'use client';

import { useCallback } from 'react';

interface UseExportJsonOptions {
  data: unknown | null;
  filename: string;
}

interface UseExportJsonResult {
  exportJson: () => void;
}

/**
 * Hook for exporting ProcessedDocument as a JSON file.
 */
export function useExportJson({
  data,
  filename,
}: UseExportJsonOptions): UseExportJsonResult {
  const exportJson = useCallback(() => {
    if (!data) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename.replace('.pdf', '')}-processed.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, filename]);

  return { exportJson };
}
