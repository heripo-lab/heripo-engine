import { existsSync } from 'fs';
import { NextResponse } from 'next/server';

import { paths } from '~/lib/paths';
import { PDFParserManager } from '~/lib/queue/pdf-parser-manager';
import { TaskQueueManager } from '~/lib/queue/task-queue-manager';

export async function GET() {
  try {
    // Check database file exists
    const dbPath = paths.database.replace('.db', '.json');
    const dbExists = existsSync(dbPath);

    // Check PDFParser status
    const pdfParserManager = PDFParserManager.getInstance();
    const pdfParserStatus = await pdfParserManager.getStatus();
    const pdfParserReady = pdfParserStatus === 'ready';
    const pdfParserInitializing = pdfParserStatus === 'initializing';

    // Get queue status
    const queueManager = TaskQueueManager.getInstance();
    const queueStatus = queueManager.getStatus();

    return NextResponse.json({
      status:
        dbExists && (pdfParserReady || pdfParserInitializing)
          ? 'healthy'
          : 'degraded',
      components: {
        database: {
          status: dbExists ? 'connected' : 'disconnected',
        },
        pdfParser: {
          status: pdfParserStatus,
        },
        queue: {
          queueLength: queueStatus.queueLength,
          activeWorkers: queueStatus.activeCount,
          maxConcurrency: queueStatus.maxConcurrency,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting system status:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
