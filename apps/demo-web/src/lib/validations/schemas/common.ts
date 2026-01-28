import { z } from 'zod';

/**
 * Task ID format: task_<uuid>
 */
export const taskIdSchema = z.string().regex(/^task_[a-f0-9-]{36}$/, {
  message: 'Invalid task ID format',
});

/**
 * Image ID: non-empty string
 */
export const imageIdSchema = z.string().min(1, {
  message: 'Image ID is required',
});

/**
 * Page index: non-negative integer
 */
export const pageIndexSchema = z.coerce.number().int().nonnegative({
  message: 'Page index must be a non-negative integer',
});

/**
 * Task status enum
 */
export const taskStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;
