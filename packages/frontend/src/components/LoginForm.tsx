import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { signIn } from '../auth/cognito-auth';
import { setToken } from '../auth/token';

const accentButton = { background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' } as const;

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => signIn(email, password),
    onSuccess: (idToken) => {
      setToken(idToken);
      onLoggedIn();
    },
  });

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (!mutation.isPending) mutation.mutate(); }} style={{ display: 'grid', gap: '0.75rem' }}>
      <p className="muted">Organizer sign-in.</p>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {mutation.isError && (
        <p role="alert" className="muted">
          {mutation.error instanceof Error ? mutation.error.message : 'Sign-in failed'}
        </p>
      )}
      <button type="submit" disabled={mutation.isPending} style={accentButton}>
        {mutation.isPending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
