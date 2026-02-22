import type { NextRequest } from 'next/server';

import { existsSync, mkdirSync } from 'fs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { verifyTOTP } from '~/lib/auth/totp';
import { isTurnstileTokenValid } from '~/lib/auth/turnstile';
import {
  type UploadSessionPayload,
  createUploadSessionToken,
} from '~/lib/auth/upload-session';
import {
  canAttemptOTP,
  recordOTPAttempt,
} from '~/lib/db/repositories/otp-lockout-repository';
import { createUploadSession } from '~/lib/db/repositories/upload-session-repository';
import { getUsageStatus } from '~/lib/db/repositories/usage-repository';
import { paths } from '~/lib/paths';
import { getOrCreateSessionId } from '~/lib/session';
import { extractClientInfo } from '~/lib/utils/request-info';
import {
  createValidationErrorResponse,
  pdfFileMetadataSchema,
  processingOptionsSchema,
} from '~/lib/validations';
import {
  createOTPFailedPayload,
  createOTPLockedPayload,
  createRateLimitExceededPayload,
  sendWebhookAsync,
} from '~/lib/webhook';

import { DEFAULT_FORM_VALUES } from '~/features/upload/types/form-values';

// Chunk size: 10MB
const CHUNK_SIZE = 10 * 1024 * 1024;
// Session expiration: 30 minutes
const SESSION_EXPIRATION_MS = 30 * 60 * 1000;

const createSessionRequestSchema = z.object({
  filename: z.string().min(1),
  fileSize: z
    .number()
    .positive()
    .max(2 * 1024 * 1024 * 1024), // Max 2GB
  fileType: z.literal('application/pdf'),
  options: processingOptionsSchema.optional(),
  bypassCode: z.string().optional(),
  turnstileToken: z.string().optional(),
});

function generateUploadId(): string {
  return `upload_${crypto.randomUUID()}`;
}

export async function POST(request: NextRequest) {
  try {
    const sessionId = await getOrCreateSessionId();
    const clientInfo = extractClientInfo(request);

    // Parse request body
    const body = await request.json();
    const validation = createSessionRequestSchema.safeParse(body);

    if (!validation.success) {
      return createValidationErrorResponse(validation.error);
    }

    const { filename, fileSize, fileType, bypassCode, turnstileToken } =
      validation.data;

    // Validate file metadata
    const fileMetadataValidation = pdfFileMetadataSchema.safeParse({
      name: filename,
      type: fileType,
      size: fileSize,
    });

    if (!fileMetadataValidation.success) {
      return createValidationErrorResponse(fileMetadataValidation.error);
    }

    // Public mode: enforce rate limiting and default options
    const isPublicMode = process.env.NEXT_PUBLIC_PUBLIC_MODE === 'true';

    let options = validation.data.options;
    if (isPublicMode) {
      // Use default options, but allow user-provided ocrLanguages
      const { file: _, ...defaultOptions } = DEFAULT_FORM_VALUES;
      options = {
        ...defaultOptions,
        ocrLanguages:
          validation.data.options?.ocrLanguages ?? defaultOptions.ocrLanguages,
      };
    } else if (!options) {
      return NextResponse.json(
        { error: 'No options provided' },
        { status: 400 },
      );
    }

    // Public mode: OTP-first verification to avoid Turnstile timing issues
    let isOtpBypass = false;
    if (isPublicMode) {
      if (bypassCode) {
        // Step 1: bypassCode provided - verify OTP first (skip Turnstile)
        const identifier = 'global';
        const attemptCheck = canAttemptOTP(identifier);
        if (!attemptCheck.allowed) {
          sendWebhookAsync(
            createOTPLockedPayload({
              ...clientInfo,
              filename,
            }),
          );

          return NextResponse.json(
            {
              error: attemptCheck.reason,
              code: 'OTP_PERMANENTLY_LOCKED',
            },
            { status: 403 },
          );
        }

        const isValid = verifyTOTP(bypassCode);
        recordOTPAttempt(identifier, isValid);

        if (!isValid) {
          const updatedCheck = canAttemptOTP(identifier);
          const remainingAttempts = updatedCheck.remainingAttempts ?? 0;

          if (remainingAttempts > 0) {
            sendWebhookAsync(
              createOTPFailedPayload({
                ...clientInfo,
                filename,
                remainingAttempts,
              }),
            );
          } else {
            sendWebhookAsync(
              createOTPLockedPayload({
                ...clientInfo,
                filename,
              }),
            );
          }

          return NextResponse.json(
            {
              error:
                remainingAttempts > 0
                  ? `Invalid bypass code. ${remainingAttempts} ${remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining.`
                  : 'Invalid bypass code. Your access has been permanently blocked.',
              code: remainingAttempts > 0 ? 'INVALID_OTP' : 'OTP_LOCKED',
              remainingAttempts,
            },
            { status: remainingAttempts > 0 ? 401 : 403 },
          );
        }

        // OTP passed - skip Turnstile
        isOtpBypass = true;

        // OTP bypass: use user-provided options instead of defaults
        if (validation.data.options) {
          options = validation.data.options;
        }
      } else {
        // Step 2: No bypassCode - require Turnstile
        if (!turnstileToken) {
          return NextResponse.json(
            {
              error: 'Turnstile verification required',
              code: 'INVALID_TURNSTILE',
            },
            { status: 400 },
          );
        }

        const isValidTurnstile = await isTurnstileTokenValid(turnstileToken);
        if (!isValidTurnstile) {
          return NextResponse.json(
            {
              error: 'Turnstile verification failed',
              code: 'INVALID_TURNSTILE',
            },
            { status: 400 },
          );
        }

        // Step 3: Check rate limit (only for non-OTP users)
        const usageStatus = getUsageStatus();
        if (!usageStatus.canCreate) {
          sendWebhookAsync(
            createRateLimitExceededPayload({
              ...clientInfo,
              filename,
              dailyLimit: usageStatus.dailyLimit,
              todayCompleted: usageStatus.todayCompleted,
            }),
          );

          return NextResponse.json(
            {
              error: usageStatus.reason,
              code: 'RATE_LIMIT_EXCEEDED',
            },
            { status: 429 },
          );
        }
      }
    }

    // Check UPLOAD_SESSION_SECRET is configured
    if (!process.env.UPLOAD_SESSION_SECRET) {
      return NextResponse.json(
        {
          error: 'Upload session is not configured on the server',
          code: 'UPLOAD_NOT_CONFIGURED',
        },
        { status: 500 },
      );
    }

    // Calculate total chunks
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    const uploadId = generateUploadId();
    const uploadPaths = paths.upload(uploadId);

    // Create chunk directory
    if (!existsSync(uploadPaths.chunksDir)) {
      mkdirSync(uploadPaths.chunksDir, { recursive: true });
    }

    // Calculate expiration time
    const expiresAt = new Date(
      Date.now() + SESSION_EXPIRATION_MS,
    ).toISOString();

    // Create upload session in database
    createUploadSession({
      id: uploadId,
      sessionId,
      filename,
      fileSize,
      totalChunks,
      chunkDir: uploadPaths.chunksDir,
      clientIp: clientInfo.ip,
      isOtpBypass,
      options,
      expiresAt,
    });

    // Generate JWT token
    const tokenPayload: UploadSessionPayload = {
      sessionId,
      uploadId,
      clientIp: clientInfo.ip,
      filename,
      fileSize,
      totalChunks,
      isOtpBypass,
    };

    const token = await createUploadSessionToken(tokenPayload);

    if (!token) {
      return NextResponse.json(
        {
          error: 'Failed to create upload session token',
          code: 'TOKEN_CREATION_FAILED',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      uploadSessionId: uploadId,
      uploadSessionToken: token,
      totalChunks,
      chunkSize: CHUNK_SIZE,
      expiresAt,
    });
  } catch (error) {
    console.error('Error creating upload session:', error);
    return NextResponse.json(
      { error: 'Failed to create upload session' },
      { status: 500 },
    );
  }
}
