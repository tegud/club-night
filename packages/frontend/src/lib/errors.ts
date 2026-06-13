import { ApiError } from '../api/client';

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong';
}
