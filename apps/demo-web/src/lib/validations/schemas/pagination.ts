import { z } from 'zod';

/**
 * Pagination query parameters schema.
 * Used for list endpoints with limit/offset pagination.
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type PaginationParams = z.infer<typeof paginationSchema>;
