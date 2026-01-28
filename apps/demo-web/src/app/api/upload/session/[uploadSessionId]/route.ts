import type { NextRequest } from 'next/server';

import { existsSync, rmSync } from 'fs';
import { NextResponse } from 'next/server';

import {
  extractBearerToken,
  verifyUploadSessionToken,
} from '~/lib/auth/upload-session';
import {
  deleteUploadSession,
  getUploadSessionById,
  updateUploadSessionStatus,
} from '~/lib/db/repositories/upload-session-repository';
import { paths } from '~/lib/paths';
import { extractClientInfo } from '~/lib/utils/request-info';

interface RouteContext {
  params: Promise<{
    uploadSessionId: string;
  }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { uploadSessionId } = await context.params;
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

    // Verify upload session ID matches token
    if (payload.uploadId !== uploadSessionId) {
      return NextResponse.json(
        {
          error: 'Upload session ID does not match token',
          code: 'SESSION_MISMATCH',
        },
        { status: 403 },
      );
    }

    // Check upload session exists
    const uploadSession = getUploadSessionById(uploadSessionId);

    if (!uploadSession) {
      return NextResponse.json(
        {
          error: 'Upload session not found',
          code: 'SESSION_NOT_FOUND',
        },
        { status: 404 },
      );
    }

    // Only allow cancellation of uploading sessions
    if (uploadSession.status !== 'uploading') {
      return NextResponse.json(
        {
          error: `Cannot cancel session with status: ${uploadSession.status}`,
          code: 'SESSION_INVALID_STATUS',
        },
        { status: 400 },
      );
    }

    // Mark session as cancelled
    updateUploadSessionStatus(uploadSessionId, 'cancelled');

    // Clean up chunk directory
    const uploadPaths = paths.upload(uploadSessionId);
    if (existsSync(uploadPaths.root)) {
      rmSync(uploadPaths.root, { recursive: true, force: true });
    }

    // Delete session record
    deleteUploadSession(uploadSessionId);

    return NextResponse.json({
      success: true,
      message: 'Upload session cancelled and cleaned up',
    });
  } catch (error) {
    console.error('Error cancelling upload session:', error);
    return NextResponse.json(
      { error: 'Failed to cancel upload session' },
      { status: 500 },
    );
  }
}
