import { ArrowRight, Lock } from 'lucide-react';

import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';

export function NextStageBanner() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex items-center justify-between py-6">
        <div className="flex items-center gap-4">
          <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
            <Lock className="text-muted-foreground h-5 w-5" />
          </div>
          <div>
            <p className="font-medium">Next: Ledger Extraction</p>
            <p className="text-muted-foreground text-sm">
              Extract structured ledger data from ProcessedDocument
            </p>
          </div>
        </div>
        <Button variant="outline" disabled>
          Coming Soon
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
