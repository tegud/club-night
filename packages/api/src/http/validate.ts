import type { ZodSchema } from 'zod';
import { ValidationError } from './errors';

export function parseOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Validation failed', result.error.flatten());
  }
  return result.data;
}
