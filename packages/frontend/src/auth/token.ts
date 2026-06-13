const KEY = 'club-night.token';

export function getToken(): string | null {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
}
export function setToken(token: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(KEY, token);
  else localStorage.removeItem(KEY);
}
