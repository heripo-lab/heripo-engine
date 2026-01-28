import { FileQuestion } from 'lucide-react';

interface EmptyPageContentProps {
  pdfPageNo: number;
}

/**
 * Displayed when the current page has no content in the selected chapter.
 */
export function EmptyPageContent({ pdfPageNo }: EmptyPageContentProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <FileQuestion className="text-muted-foreground mb-4 h-12 w-12" />
      <p className="text-muted-foreground">
        No content on PDF page {pdfPageNo} in this chapter
      </p>
    </div>
  );
}
