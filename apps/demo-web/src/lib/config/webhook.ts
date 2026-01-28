/**
 * Webhook configuration for public mode notifications.
 */
export interface WebhookConfig {
  enabled: boolean;
  url: string | null;
  secret: string | null;
}

/**
 * Returns the webhook configuration.
 * Webhooks are only enabled when:
 * - Public mode is enabled (NEXT_PUBLIC_PUBLIC_MODE=true)
 * - WEBHOOK_URL is set
 * - WEBHOOK_SECRET is set
 */
export function getWebhookConfig(): WebhookConfig {
  const isPublicMode = process.env.NEXT_PUBLIC_PUBLIC_MODE === 'true';
  const url = process.env.WEBHOOK_URL || null;
  const secret = process.env.WEBHOOK_SECRET || null;

  // Only enabled in public mode with both URL and secret configured
  const enabled = isPublicMode && !!url && !!secret;

  return {
    enabled,
    url,
    secret,
  };
}
