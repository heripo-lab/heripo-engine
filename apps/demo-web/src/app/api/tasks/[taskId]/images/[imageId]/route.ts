import type { ProcessedDocument, ProcessedImage } from '@heripo/model';
import type { NextRequest } from 'next/server';

import { existsSync, readFileSync } from 'fs';
import { NextResponse } from 'next/server';
import { dirname, extname, resolve } from 'path';

import { getTaskByIdForSession } from '~/lib/db/repositories/task-repository';
import { getOrCreateSessionId } from '~/lib/session';
import {
  createValidationErrorResponse,
  imageRouteParamsSchema,
  parseRouteParams,
} from '~/lib/validations';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string; imageId: string }> },
) {
  try {
    const sessionId = await getOrCreateSessionId();
    const rawParams = await params;

    const validation = parseRouteParams(rawParams, imageRouteParamsSchema);
    if (!validation.success) {
      return createValidationErrorResponse(validation.error);
    }

    const { taskId, imageId } = validation.data;
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

    const resultJson = readFileSync(task.processedResultPath, 'utf8');
    const result = JSON.parse(resultJson) as ProcessedDocument;

    const image = result.images.find(
      (img: ProcessedImage) => img.id === imageId,
    );

    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Validate image path to prevent path traversal attacks
    const resolvedPath = resolve(image.path);
    const expectedDir = resolve(dirname(task.processedResultPath), 'images');
    if (!resolvedPath.startsWith(expectedDir + '/')) {
      return NextResponse.json(
        { error: 'Invalid image path' },
        { status: 403 },
      );
    }

    if (!existsSync(resolvedPath)) {
      return NextResponse.json(
        { error: 'Image file not found' },
        { status: 404 },
      );
    }

    const imageBuffer = readFileSync(resolvedPath);
    const ext = extname(image.path).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving image:', error);
    return NextResponse.json(
      { error: 'Failed to serve image' },
      { status: 500 },
    );
  }
}
