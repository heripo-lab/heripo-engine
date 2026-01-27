'use client';

import type { ReactNode } from 'react';

import {
  Bug,
  Download,
  Info,
  RefreshCw,
  Shield,
  Square,
  Wrench,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

export function ProcessInfoCard() {
  return (
    <Card className="border-muted">
      <CardHeader className="pb-3">
        <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
          <Info className="h-4 w-4" />
          Important Information
        </CardTitle>
        <CardDescription className="text-xs">
          Please keep the following in mind while using this service.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <InfoItem
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            title="Background Processing"
            description="Processing continues in the background even if you close or refresh the browser."
          />

          <InfoItem
            icon={<Square className="h-3.5 w-3.5" />}
            title="Cancel Processing"
            description="Click the Cancel button above to stop processing."
          />

          <InfoItem
            icon={<Wrench className="h-3.5 w-3.5" />}
            title="Work in Progress"
            description="This system is continuously being improved. Errors may occur during processing."
          />

          <InfoItem
            icon={<Bug className="h-3.5 w-3.5" />}
            title="Report Issues"
          >
            Found a problem?{' '}
            <a
              href="https://github.com/heripo-lab/heripo-engine/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:no-underline"
            >
              Report it here
            </a>
            .
          </InfoItem>

          <InfoItem
            icon={<Shield className="h-3.5 w-3.5" />}
            title="Session-Based Access"
            description="Tasks and results are only accessible from this browser."
          />

          <InfoItem
            icon={<Download className="h-3.5 w-3.5" />}
            title="Download Results"
            description="Download your results from the result page after processing."
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface InfoItemProps {
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}

function InfoItem({ icon, title, description, children }: InfoItemProps) {
  return (
    <div className="flex gap-2">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="font-medium">{title}</p>
        {description && (
          <p className="text-muted-foreground text-xs">{description}</p>
        )}
        {children && (
          <p className="text-muted-foreground text-xs">{children}</p>
        )}
      </div>
    </div>
  );
}
