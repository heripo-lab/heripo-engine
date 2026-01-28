import type { WebhookPayload } from './types';

import { createHmac } from 'crypto';

import { getWebhookConfig } from '../config/webhook';

const WEBHOOK_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Generates HMAC-SHA256 signature for webhook payload.
 */
function generateSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Sends webhook notification.
 * Errors are logged but don't affect the calling operation.
 */
async function sendWebhook(payload: WebhookPayload): Promise<void> {
  const config = getWebhookConfig();

  if (!config.enabled || !config.url || !config.secret) {
    return;
  }

  const payloadString = JSON.stringify(payload);
  const signature = generateSignature(payloadString, config.secret);

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': payload.event,
      },
      body: payloadString,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        `[Webhook] Failed to send ${payload.event}: ${response.status} ${response.statusText}`,
      );
    }
  } catch (error) {
    // Log error but don't throw - fire-and-forget
    console.error(
      `[Webhook] Error sending ${payload.event}:`,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

/**
 * Sends webhook notification without blocking.
 * Uses void to explicitly indicate fire-and-forget intent.
 */
export function sendWebhookAsync(payload: WebhookPayload): void {
  // Fire and forget - don't await
  void sendWebhook(payload);
}
