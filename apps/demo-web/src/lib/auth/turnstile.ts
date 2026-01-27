/**
 * Validates a Turnstile CAPTCHA token with Cloudflare's API
 *
 * This function sends the token received from the client-side Turnstile widget
 * to Cloudflare's verification endpoint to confirm that the user successfully
 * completed the CAPTCHA challenge.
 *
 * @param token - The token received from the client-side Turnstile widget
 * @returns Promise resolving to a boolean indicating if the token is valid
 */
export async function isTurnstileTokenValid(token: string): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.warn('TURNSTILE_SECRET_KEY is not configured');
    return false;
  }

  const url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

  try {
    const result = await fetch(url, {
      body: JSON.stringify({
        secret: secretKey,
        response: token,
      }),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const outcome = await result.json();
    return outcome.success as boolean;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Turnstile verification timed out');
    } else {
      console.error('Turnstile verification failed:', error);
    }
    return false;
  }
}
