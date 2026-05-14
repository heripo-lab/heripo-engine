import type { NextRequest } from 'next/server';
import type { Transform } from 'stream';
import type { ZlibOptions } from 'zlib';

import * as archiver from 'archiver';
import { existsSync, statSync } from 'fs';
import { NextResponse } from 'next/server';
import { dirname, join } from 'path';
import { Readable } from 'stream';

import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import { getOrCreateSessionId } from '~/lib/session';
import {
  createValidationErrorResponse,
  parseRouteParams,
  taskRouteParamsSchema,
} from '~/lib/validations';

interface ZipArchiveOptions {
  zlib?: ZlibOptions;
}

interface ZipArchiveStream extends Transform {
  file(filename: string, data: { name: string }): this;
  directory(dirpath: string, destpath: string): this;
  finalize(): Promise<void>;
}

const ZipArchive = (
  archiver as unknown as {
    ZipArchive: new (options?: ZipArchiveOptions) => ZipArchiveStream;
  }
).ZipArchive;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const sessionId = await getOrCreateSessionId();
    const rawParams = await params;

    const validation = parseRouteParams(rawParams, taskRouteParamsSchema);
    if (!validation.success) {
      return createValidationErrorResponse(validation.error);
    }

    const { taskId } = validation.data;
    const task = getTaskByIdForSession(taskId, sessionId);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.status !== 'completed') {
      return NextResponse.json(
        { error: 'Task is not completed yet', status: task.status },
        { status: 400 },
      );
    }

    if (!task.processedResultPath || !existsSync(task.processedResultPath)) {
      return NextResponse.json(
        { error: 'Result file not found' },
        { status: 404 },
      );
    }

    const taskDir = dirname(task.processedResultPath);
    const doclingResultPath = join(taskDir, 'result.json');
    const sourceHandoffManifestPath = join(
      taskDir,
      'source-handoff-manifest.json',
    );
    const imagesDir = join(taskDir, 'images');
    const pagesDir = join(taskDir, 'pages');

    const archive = new ZipArchive({
      zlib: { level: 6 },
    });

    archive.file(task.processedResultPath, { name: 'result-processed.json' });

    if (existsSync(doclingResultPath)) {
      archive.file(doclingResultPath, { name: 'result.json' });
    }

    if (existsSync(sourceHandoffManifestPath)) {
      archive.file(sourceHandoffManifestPath, {
        name: 'source-handoff-manifest.json',
      });
    }

    if (existsSync(imagesDir) && statSync(imagesDir).isDirectory()) {
      archive.directory(imagesDir, 'images');
    }

    if (existsSync(pagesDir) && statSync(pagesDir).isDirectory()) {
      archive.directory(pagesDir, 'pages');
    }

    archive.finalize();

    const webStream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;

    const sanitizedFilename = task.originalFilename
      .replace('.pdf', '')
      .replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    const zipFilename = `${sanitizedFilename}-all.zip`;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(zipFilename)}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Error creating download:', error);
    return NextResponse.json(
      { error: 'Failed to create download' },
      { status: 500 },
    );
  }
}
