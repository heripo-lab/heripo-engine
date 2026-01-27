import type { Chapter } from '@heripo/model';

import { Badge } from '~/components/ui/badge';
import { CardDescription, CardTitle } from '~/components/ui/card';

import { PageLink } from './page-link';

interface ChapterHeaderProps {
  chapter: Chapter;
}

export function ChapterHeader({ chapter }: ChapterHeaderProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <CardTitle className="text-lg">{chapter.title}</CardTitle>
        <Badge variant="outline">Level {chapter.level}</Badge>
      </div>
      <CardDescription className="flex items-center gap-2">
        <PageLink pageNo={chapter.pageNo} pageType="document">
          Page {chapter.pageNo}
        </PageLink>
        {chapter.originTitle !== chapter.title && (
          <>
            <span className="text-muted-foreground">|</span>
            <span className="text-xs italic">
              Original: {chapter.originTitle}
            </span>
          </>
        )}
      </CardDescription>
    </div>
  );
}
