import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

interface EmptyStateProps {
  hasChapters: boolean;
}

export function EmptyState({ hasChapters }: EmptyStateProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Chapter Content</CardTitle>
        <CardDescription>Select a chapter to view its content</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="bg-muted/50 rounded-md p-4">
          <p className="text-muted-foreground text-sm">
            {hasChapters
              ? 'Select a chapter from the tree to view its content.'
              : 'No chapters extracted from this document.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyChapterContent() {
  return (
    <div className="bg-muted/30 rounded-md p-4 text-center">
      <p className="text-muted-foreground text-sm">
        This chapter has no content (text, images, tables, or footnotes).
      </p>
    </div>
  );
}
