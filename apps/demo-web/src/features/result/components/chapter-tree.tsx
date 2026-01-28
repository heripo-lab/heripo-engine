'use client';

import type { Chapter } from '@heripo/model';

import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { useState } from 'react';

import { cn } from '~/lib/utils';

interface ChapterItemProps {
  chapter: Chapter;
  level?: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function ChapterItem({
  chapter,
  level = 0,
  selectedId,
  onSelect,
}: ChapterItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = chapter.children && chapter.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          'flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 transition-colors',
          'hover:bg-accent',
          selectedId === chapter.id && 'bg-accent',
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onSelect(chapter.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="hover:bg-muted rounded p-0.5"
          >
            {isExpanded ? (
              <ChevronDown className="text-muted-foreground h-4 w-4" />
            ) : (
              <ChevronRight className="text-muted-foreground h-4 w-4" />
            )}
          </button>
        ) : (
          <FileText className="text-muted-foreground mr-0.5 ml-0.5 h-4 w-4" />
        )}
        <span className="flex-1 truncate text-sm">
          {chapter.title || chapter.originTitle}
        </span>
        {chapter.pageNo !== undefined && (
          <span className="text-muted-foreground text-xs">
            {chapter.pageNo}
          </span>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div>
          {chapter.children!.map((child) => (
            <ChapterItem
              key={child.id}
              chapter={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ChapterTreeProps {
  chapters: Chapter[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function ChapterTree({
  chapters,
  selectedId,
  onSelect,
}: ChapterTreeProps) {
  if (chapters.length === 0) {
    return (
      <div className="text-muted-foreground py-4 text-center text-sm">
        No chapters available
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {chapters.map((chapter) => (
        <ChapterItem
          key={chapter.id}
          chapter={chapter}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
