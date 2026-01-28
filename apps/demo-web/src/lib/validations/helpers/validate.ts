import type { CreateTaskFormData } from '../schemas/task';

import { z } from 'zod';

import { createTaskFormDataSchema } from '../schemas/task';

type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

/**
 * Validate route parameters from Next.js dynamic routes.
 */
export function parseRouteParams<T extends z.ZodTypeAny>(
  params: unknown,
  schema: T,
): SafeParseResult<z.infer<T>> {
  return schema.safeParse(params) as SafeParseResult<z.infer<T>>;
}

/**
 * Parse and validate URL search parameters.
 */
export function parseQueryParams<T extends z.ZodTypeAny>(
  searchParams: URLSearchParams,
  schema: T,
): SafeParseResult<z.infer<T>> {
  const params: Record<string, string | undefined> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return schema.safeParse(params) as SafeParseResult<z.infer<T>>;
}

/**
 * Result type for FormData parsing.
 */
export type ParseFormDataResult =
  | { success: true; data: CreateTaskFormData; rawFile: File }
  | { success: false; error: z.ZodError };

/**
 * Parse and validate FormData for task creation.
 * Returns a structured result with typed data or validation errors.
 */
export function parseCreateTaskFormData(
  formData: FormData,
): ParseFormDataResult {
  const file = formData.get('file') as File | null;
  const optionsJson = formData.get('options') as string | null;
  const bypassCode = formData.get('bypassCode') as string | null;

  // Build object for validation
  const dataToValidate: Record<string, unknown> = {};

  // File validation - extract metadata
  if (file) {
    dataToValidate.file = {
      name: file.name,
      type: file.type,
      size: file.size,
    };
  }

  // Options validation - parse JSON
  if (optionsJson) {
    try {
      dataToValidate.options = JSON.parse(optionsJson);
    } catch {
      // Create a ZodError for invalid JSON
      return {
        success: false,
        error: new z.ZodError([
          {
            code: 'custom',
            path: ['options'],
            message: 'Invalid options JSON',
          },
        ]),
      };
    }
  }

  // Bypass code
  if (bypassCode) {
    dataToValidate.bypassCode = bypassCode;
  }

  const result = createTaskFormDataSchema.safeParse(dataToValidate);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: result.data,
    rawFile: file!,
  };
}
