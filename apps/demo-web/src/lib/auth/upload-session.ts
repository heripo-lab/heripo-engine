import { errors as JoseErrors, SignJWT, jwtVerify } from 'jose';

export interface UploadSessionPayload {
  sessionId: string;
  uploadId: string;
  clientIp: string;
  filename: string;
  fileSize: number;
  totalChunks: number;
  isOtpBypass: boolean;
}

export interface VerifyResult {
  valid: true;
  payload: UploadSessionPayload;
}

export interface VerifyError {
  valid: false;
  error: 'EXPIRED' | 'INVALID' | 'MISSING_SECRET' | 'IP_MISMATCH';
  message: string;
}

export type VerifyUploadSessionResult = VerifyResult | VerifyError;

const ALGORITHM = 'HS256';
const EXPIRATION_TIME = '30m';

function getSecret(): Uint8Array | null {
  const secret = process.env.UPLOAD_SESSION_SECRET;
  if (!secret) {
    return null;
  }
  return new TextEncoder().encode(secret);
}

export async function createUploadSessionToken(
  payload: UploadSessionPayload,
): Promise<string | null> {
  const secret = getSecret();
  if (!secret) {
    return null;
  }

  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(EXPIRATION_TIME)
    .sign(secret);

  return token;
}

export async function verifyUploadSessionToken(
  token: string,
  clientIp: string,
): Promise<VerifyUploadSessionResult> {
  const secret = getSecret();
  if (!secret) {
    return {
      valid: false,
      error: 'MISSING_SECRET',
      message: 'Upload session secret is not configured',
    };
  }

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
    });

    const sessionPayload = payload as unknown as UploadSessionPayload;

    // Validate IP binding
    if (sessionPayload.clientIp !== clientIp) {
      return {
        valid: false,
        error: 'IP_MISMATCH',
        message: 'Client IP does not match the session',
      };
    }

    return {
      valid: true,
      payload: sessionPayload,
    };
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      return {
        valid: false,
        error: 'EXPIRED',
        message: 'Upload session has expired',
      };
    }

    return {
      valid: false,
      error: 'INVALID',
      message: 'Invalid upload session token',
    };
  }
}

export function extractBearerToken(
  authorizationHeader: string | null,
): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const parts = authorizationHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}
