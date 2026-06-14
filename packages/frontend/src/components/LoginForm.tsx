import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { signIn } from '../auth/cognito-auth';
import { setToken } from '../auth/token';

const accentButton = { background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' } as const;

type CompleteNewPassword = (newPassword: string) => Promise<string>;

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  // Set when Cognito asks an admin-created organizer to choose a real password on first sign-in.
  const [completeNewPassword, setCompleteNewPassword] = useState<CompleteNewPassword | null>(null);

  const finish = (idToken: string) => {
    setToken(idToken);
    onLoggedIn();
  };

  const signInMutation = useMutation({
    mutationFn: () => signIn(email, password),
    onSuccess: (result) => {
      if (result.challenge === 'NONE') finish(result.idToken);
      // Store the callback itself (wrap so React doesn't treat it as a state updater).
      else setCompleteNewPassword(() => result.completeNewPassword);
    },
  });

  const newPasswordMutation = useMutation({
    mutationFn: () => completeNewPassword!(newPassword),
    onSuccess: finish,
  });

  if (completeNewPassword) {
    return (
      <form
        className="card"
        onSubmit={(e) => { e.preventDefault(); if (!newPasswordMutation.isPending) newPasswordMutation.mutate(); }}
        style={{ display: 'grid', gap: '0.75rem' }}
      >
        <p className="muted">Choose a new password to finish signing in.</p>
        <label>New password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></label>
        {newPasswordMutation.isError && (
          <p role="alert" className="muted">
            {newPasswordMutation.error instanceof Error ? newPasswordMutation.error.message : 'Could not set new password'}
          </p>
        )}
        <button type="submit" disabled={newPasswordMutation.isPending} style={accentButton}>
          {newPasswordMutation.isPending ? 'Saving…' : 'Set password & sign in'}
        </button>
      </form>
    );
  }

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (!signInMutation.isPending) signInMutation.mutate(); }} style={{ display: 'grid', gap: '0.75rem' }}>
      <p className="muted">Organizer sign-in.</p>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {signInMutation.isError && (
        <p role="alert" className="muted">
          {signInMutation.error instanceof Error ? signInMutation.error.message : 'Sign-in failed'}
        </p>
      )}
      <button type="submit" disabled={signInMutation.isPending} style={accentButton}>
        {signInMutation.isPending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
