import { readDatabase, writeDatabase } from '../index';

const MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || '3', 10);

export interface OTPAttemptResult {
  allowed: boolean;
  reason?: string;
  remainingAttempts?: number;
}

export function canAttemptOTP(identifier: string): OTPAttemptResult {
  const db = readDatabase();
  const lockout = db.otpLockouts.find((l) => l.identifier === identifier);

  if (!lockout) {
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS };
  }

  if (lockout.is_permanently_locked) {
    return {
      allowed: false,
      reason:
        'Your access has been permanently blocked due to too many failed attempts. Please contact the administrator.',
    };
  }

  const remainingAttempts = MAX_ATTEMPTS - lockout.failed_attempts;
  return { allowed: true, remainingAttempts };
}

export function recordOTPAttempt(identifier: string, success: boolean): void {
  const db = readDatabase();
  const lockoutIndex = db.otpLockouts.findIndex(
    (l) => l.identifier === identifier,
  );

  if (success) {
    // Success: remove lockout record
    if (lockoutIndex !== -1) {
      db.otpLockouts.splice(lockoutIndex, 1);
      writeDatabase(db);
    }
    return;
  }

  // Failure
  const now = new Date().toISOString();

  if (lockoutIndex === -1) {
    // First failure
    db.otpLockouts.push({
      identifier,
      failed_attempts: 1,
      first_failed_at: now,
      is_permanently_locked: false,
      locked_at: null,
    });
  } else {
    const lockout = db.otpLockouts[lockoutIndex];
    const newAttempts = lockout.failed_attempts + 1;

    if (newAttempts >= MAX_ATTEMPTS) {
      // 3rd failure: permanent lockout
      lockout.failed_attempts = newAttempts;
      lockout.is_permanently_locked = true;
      lockout.locked_at = now;
    } else {
      // 2nd failure: increment counter
      lockout.failed_attempts = newAttempts;
    }
  }

  writeDatabase(db);
}
