import type { NextRequest } from 'next/server';

/**
 * Client information extracted from the request.
 */
export interface ClientInfo {
  ip: string;
  userAgent: string;
}

/**
 * Extracts client information (IP address and User-Agent) from a Next.js request.
 * Checks common headers used by proxies and load balancers.
 */
export function extractClientInfo(request: NextRequest): ClientInfo {
  // IP Priority: x-forwarded-for > x-real-ip > cf-connecting-ip > request.ip
  const forwardedFor = request.headers.get('x-forwarded-for');
  let ip: string;

  if (forwardedFor) {
    // Take first IP if multiple (client's original IP)
    ip = forwardedFor.split(',')[0].trim();
  } else {
    ip =
      request.headers.get('x-real-ip') ||
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('true-client-ip') ||
      'unknown';
  }

  const userAgent = request.headers.get('user-agent') || 'unknown';

  return { ip, userAgent };
}
