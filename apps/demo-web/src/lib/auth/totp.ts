import { verifySync } from 'otplib';

export function verifyTOTP(code: string): boolean {
  const totpSecret = process.env.TOTP_SECRET;
  if (!totpSecret) {
    return false;
  }

  try {
    const result = verifySync({ token: code, secret: totpSecret });
    return result.valid;
  } catch {
    return false;
  }
}
