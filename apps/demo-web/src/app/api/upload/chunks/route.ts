import type { NextRequest } from 'next/server';

import { writeFileSync } from 'fs';
import { NextResponse } from 'next/server';

import {
  extractBearerToken,
  verifyUploadSessionToken,
} from '~/lib/auth/upload-session';
import {
  addReceivedChunk,
  getUploadSessionById,
} from '~/lib/db/repositories/upload-session-repository';
import { paths } from '~/lib/paths';
import { extractClientInfo } from '~/lib/utils/request-info';

export async function POST(request: NextRequest) {
  try {
    const clientInfo = extractClientInfo(request);

    // Extract and verify JWT token
    const authHeader = request.headers.get('authorization');
    const token = extractBearerToken(authHeader);

    if (!token) {
      return NextResponse.json(
        {
          error: 'Authorization header with Bearer token required',
          code: 'UNAUTHORIZED',
        },
        { status: 401 },
      );
    }

    const verifyResult = await verifyUploadSessionToken(token, clientInfo.ip);

    if (!verifyResult.valid) {
      return NextResponse.json(
        {
          error: verifyResult.message,
          code: verifyResult.error,
        },
        { status: verifyResult.error === 'EXPIRED' ? 401 : 403 },
      );
    }

    const { payload } = verifyResult;

    // Check upload session exists and is in uploading status
    const uploadSession = getUploadSessionById(payload.uploadId);

    if (!uploadSession) {
      return NextResponse.json(
        {
          error: 'Upload session not found',
          code: 'SESSION_NOT_FOUND',
        },
        { status: 404 },
      );
    }

    if (uploadSession.status !== 'uploading') {
      return NextResponse.json(
        {
          error: `Upload session is ${uploadSession.status}`,
          code: 'SESSION_INVALID_STATUS',
        },
        { status: 400 },
      );
    }

    // Check session expiration
    if (new Date(uploadSession.expiresAt) < new Date()) {
      return NextResponse.json(
        {
          error: 'Upload session has expired',
          code: 'SESSION_EXPIRED',
        },
        { status: 401 },
      );
    }

    // Parse form data
    const formData = await request.formData();
    const chunkIndexStr = formData.get('chunkIndex') as string | null;
    const chunkData = formData.get('chunk') as Blob | null;

    if (chunkIndexStr === null || chunkData === null) {
      return NextResponse.json(
        {
          error: 'Missing chunkIndex or chunk data',
          code: 'INVALID_REQUEST',
        },
        { status: 400 },
      );
    }

    const chunkIndex = parseInt(chunkIndexStr, 10);

    if (
      isNaN(chunkIndex) ||
      chunkIndex < 0 ||
      chunkIndex >= payload.totalChunks
    ) {
      return NextResponse.json(
        {
          error: `Invalid chunk index: ${chunkIndex}. Must be 0-${payload.totalChunks - 1}`,
          code: 'INVALID_CHUNK_INDEX',
        },
        { status: 400 },
      );
    }

    // Check if chunk already received
    if (uploadSession.receivedChunks.includes(chunkIndex)) {
      return NextResponse.json({
        success: true,
        message: 'Chunk already received',
        chunkIndex,
        receivedChunks: uploadSession.receivedChunks.length,
        totalChunks: payload.totalChunks,
      });
    }

    // Save chunk to file
    const uploadPaths = paths.upload(payload.uploadId);
    const chunkPath = uploadPaths.chunk(chunkIndex);
    const buffer = Buffer.from(await chunkData.arrayBuffer());

    writeFileSync(chunkPath, buffer);

    // Update database
    addReceivedChunk(payload.uploadId, chunkIndex);

    // Get updated session
    const updatedSession = getUploadSessionById(payload.uploadId);
    const receivedCount = updatedSession?.receivedChunks.length ?? 0;

    return NextResponse.json({
      success: true,
      chunkIndex,
      receivedChunks: receivedCount,
      totalChunks: payload.totalChunks,
      isComplete: receivedCount === payload.totalChunks,
    });
  } catch (error) {
    console.error('Error uploading chunk:', error);
    return NextResponse.json(
      { error: 'Failed to upload chunk' },
      { status: 500 },
    );
  }
}
