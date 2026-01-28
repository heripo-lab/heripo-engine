import { cookies } from 'next/headers';

const SESSION_COOKIE_NAME = 'heripo_session_id';
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 365 * 24 * 60 * 60, // 1 year
};

/**
 * Generates a new session ID with 'ses_' prefix
 */
export function generateSessionId(): string {
  return `ses_${crypto.randomUUID()}`;
}

/**
 * Gets the current session ID from cookies, creating one if it doesn't exist.
 * Must be called in a Server Component or API Route.
 *
 * @returns The session ID (existing or newly created)
 */
export async function getOrCreateSessionId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(SESSION_COOKIE_NAME);

  if (existing?.value) {
    return existing.value;
  }

  const newSessionId = generateSessionId();
  cookieStore.set(SESSION_COOKIE_NAME, newSessionId, SESSION_COOKIE_OPTIONS);
  return newSessionId;
}
