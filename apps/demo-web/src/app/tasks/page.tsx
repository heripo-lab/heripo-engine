'use client';

import { MobileWarningBanner } from '~/components/layout/mobile-warning-banner';
import { Card, CardContent } from '~/components/ui/card';
import { TaskListTable } from '~/features/tasks';

export default function TasksPage() {
  return (
    <div className="container mx-auto px-4 py-10 xl:px-0">
      <MobileWarningBanner />
      <div className="mx-auto max-w-7xl space-y-8">
        <h1 className="text-2xl font-bold">All Tasks</h1>
        <Card>
          <CardContent className="pt-6">
            <TaskListTable />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
