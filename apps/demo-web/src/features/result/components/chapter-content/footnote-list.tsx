import type { ProcessedFootnote } from '@heripo/model';

import { BookOpen } from 'lucide-react';

import { Badge } from '~/components/ui/badge';
import { resolveFootnoteIds } from '~/features/result/utils/chapter-lookup';

import { PageLink } from './page-link';

interface FootnoteListProps {
  footnoteIds: string[];
  footnoteMap: Map<string, ProcessedFootnote>;
}

export function FootnoteList({ footnoteIds, footnoteMap }: FootnoteListProps) {
  const resolvedFootnotes = resolveFootnoteIds(footnoteIds, footnoteMap);

  if (resolvedFootnotes.length === 0) return null;

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <BookOpen className="h-4 w-4" />
        Footnotes
        <Badge variant="secondary">{resolvedFootnotes.length}</Badge>
      </h3>
      <div className="space-y-2 border-t pt-3">
        {resolvedFootnotes.map((footnote, idx) => (
          <div
            key={footnote.id}
            className="text-muted-foreground flex gap-2 text-sm"
          >
            <span className="shrink-0 font-medium">[{idx + 1}]</span>
            <span>{footnote.text}</span>
            <span className="shrink-0 text-xs">
              (
              <PageLink pageNo={footnote.pdfPageNo} pageType="pdf">
                p.{footnote.pdfPageNo}
              </PageLink>
              )
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
