import { NextResponse } from 'next/server';

import { verifyTOTP } from '~/lib/auth/totp';
import { isTurnstileTokenValid } from '~/lib/auth/turnstile';
import { publicModeConfig } from '~/lib/config/public-mode';
import {
  canAttemptOTP,
  recordOTPAttempt,
} from '~/lib/db/repositories/otp-lockout-repository';
import { getWeeklyLockoutStatus } from '~/lib/db/repositories/success-session-repository';
import { getUsageStatus } from '~/lib/db/repositories/usage-repository';
import {
  createOTPFailedPayload,
  createOTPLockedPayload,
  createRateLimitExceededPayload,
  createSessionWeeklyLockedPayload,
  sendWebhookAsync,
} from '~/lib/webhook';

export type PublicDemoGuardResult =
  { ok: true; isOtpBypass: boolean } | { ok: false; response: NextResponse };

/**
 * Shared public-demo protection for task-creating endpoints.
 *
 * Applies the same policy the PDF task API has always used, in order:
 * 1. OTP bypass verification when a bypass code is provided (skips Turnstile)
 * 2. Turnstile verification otherwise
 * 3. Weekly session lockout (official demo, non-OTP only)
 * 4. Daily rate limit (non-OTP only)
 *
 * Outside public mode this is a no-op that reports no OTP bypass.
 */
export async function enforcePublicDemoGuards(params: {
  sessionId: string;
  clientInfo: { ip: string; userAgent: string };
  filename: string;
  bypassCode: string | null;
  turnstileToken: string | null;
}): Promise<PublicDemoGuardResult> {
  const { sessionId, clientInfo, filename, bypassCode, turnstileToken } =
    params;

  const isPublicMode = process.env.NEXT_PUBLIC_PUBLIC_MODE === 'true';
  if (!isPublicMode) {
    return { ok: true, isOtpBypass: false };
  }

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

      return {
        ok: false,
        response: NextResponse.json(
          {
            error: attemptCheck.reason,
            code: 'OTP_PERMANENTLY_LOCKED',
          },
          { status: 403 },
        ),
      };
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

      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              remainingAttempts > 0
                ? `Invalid bypass code. ${remainingAttempts} ${remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining.`
                : 'Invalid bypass code. Your access has been permanently blocked.',
            code: remainingAttempts > 0 ? 'INVALID_OTP' : 'OTP_LOCKED',
            remainingAttempts,
          },
          { status: remainingAttempts > 0 ? 401 : 403 },
        ),
      };
    }

    // OTP passed - skip Turnstile
    return { ok: true, isOtpBypass: true };
  }

  // Step 2: No bypassCode - require Turnstile
  if (!turnstileToken) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Turnstile verification required',
          code: 'INVALID_TURNSTILE',
        },
        { status: 400 },
      ),
    };
  }

  const isValidTurnstile = await isTurnstileTokenValid(turnstileToken);
  if (!isValidTurnstile) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Turnstile verification failed',
          code: 'INVALID_TURNSTILE',
        },
        { status: 400 },
      ),
    };
  }

  // Step 3: Check weekly session lockout (official demo + non-OTP only)
  if (publicModeConfig.isPublicMode && publicModeConfig.isOfficialDemo) {
    const lockoutStatus = getWeeklyLockoutStatus(sessionId);
    if (lockoutStatus.locked) {
      sendWebhookAsync(
        createSessionWeeklyLockedPayload({
          ...clientInfo,
          sessionId,
          filename,
          lockedUntil: lockoutStatus.lockedUntil!,
        }),
      );

      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              'You have already completed a task this week. Please try again later.',
            code: 'WEEKLY_SESSION_LOCKED',
            lockedUntil: lockoutStatus.lockedUntil,
          },
          { status: 429 },
        ),
      };
    }
  }

  // Step 4: Check rate limit (only for non-OTP users)
  const usageStatus = getUsageStatus();
  if (!usageStatus.canCreate) {
    sendWebhookAsync(
      createRateLimitExceededPayload({
        ...clientInfo,
        filename,
        dailyLimit: usageStatus.dailyLimit,
        todayUsed: usageStatus.todayUsed,
      }),
    );

    return {
      ok: false,
      response: NextResponse.json(
        {
          error: usageStatus.reason,
          code: 'RATE_LIMIT_EXCEEDED',
        },
        { status: 429 },
      ),
    };
  }

  return { ok: true, isOtpBypass: false };
}
