import type { TextBlock } from '@heripo/model';

import { FileText } from 'lucide-react';

import { Badge } from '~/components/ui/badge';

interface TextBlockListProps {
  textBlocks: TextBlock[];
}

/**
 * Renders a list of text blocks.
 * Content is already filtered by page, so no grouping logic needed.
 */
export function TextBlockList({ textBlocks }: TextBlockListProps) {
  if (textBlocks.length === 0) return null;

  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <FileText className="h-4 w-4" />
        Text Content
        <Badge variant="secondary">{textBlocks.length} blocks</Badge>
      </h3>
      <div className="space-y-3">
        {textBlocks.map((block, idx) => (
          <p
            key={idx}
            className="bg-muted/30 rounded-md p-3 text-sm leading-relaxed"
          >
            {block.text}
          </p>
        ))}
      </div>
    </section>
  );
}
