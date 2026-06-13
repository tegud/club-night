export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3000';

export const COGNITO_USER_POOL_ID: string = (import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined) ?? '';
export const COGNITO_CLIENT_ID: string = (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined) ?? '';
