import { Loader2 } from 'lucide-react';

export function ResultLoading() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading results...</span>
      </div>
    </div>
  );
}
