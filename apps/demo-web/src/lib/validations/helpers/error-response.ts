import type { z } from 'zod';

import { NextResponse } from 'next/server';

/**
 * Standard validation error response format.
 */
export interface ValidationErrorResponse {
  error: string;
  code: 'VALIDATION_ERROR';
  details: Array<{
    path: string;
    message: string;
  }>;
}

/**
 * Create a consistent validation error response from Zod errors.
 */
export function createValidationErrorResponse(
  error: z.ZodError,
  status: number = 400,
): NextResponse<ValidationErrorResponse> {
  const details = error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

  return NextResponse.json(
    {
      error: 'Validation failed',
      code: 'VALIDATION_ERROR' as const,
      details,
    },
    { status },
  );
}
