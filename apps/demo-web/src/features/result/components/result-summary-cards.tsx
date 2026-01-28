import type { ReactNode } from 'react';

import { FileText, Image, Table } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';

interface ResultSummaryCardsProps {
  pages: number;
  chapters: number;
  images: number;
  tables: number;
}

interface MetricCardProps {
  title: string;
  value: number;
  description: string;
  icon: ReactNode;
}

function MetricCard({ title, value, description, icon }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-muted-foreground text-xs">{description}</p>
      </CardContent>
    </Card>
  );
}

export function ResultSummaryCards({
  pages,
  chapters,
  images,
  tables,
}: ResultSummaryCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <MetricCard
        title="Pages"
        value={pages}
        description="PDF pages processed"
        icon={<FileText className="text-muted-foreground h-4 w-4" />}
      />
      <MetricCard
        title="Chapters"
        value={chapters}
        description="Hierarchical sections"
        icon={<FileText className="text-muted-foreground h-4 w-4" />}
      />
      <MetricCard
        title="Images"
        value={images}
        description="Extracted with captions"
        icon={<Image className="text-muted-foreground h-4 w-4" />}
      />
      <MetricCard
        title="Tables"
        value={tables}
        description="Structured data tables"
        icon={<Table className="text-muted-foreground h-4 w-4" />}
      />
    </div>
  );
}
