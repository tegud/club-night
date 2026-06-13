import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errors';

const accentButton = { background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' } as const;

export function GuestCodeForm({ slug, onAuthed }: { slug: string; onAuthed: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');

  const requestMutation = useMutation({
    mutationFn: () => apiClient.requestGuestCode(slug, email),
    onSuccess: () => setStep('code'),
  });
  const verifyMutation = useMutation({
    mutationFn: () => apiClient.verifyGuestCode(slug, email, code),
    onSuccess: onAuthed,
  });

  if (step === 'email') {
    return (
      <form
        className="card"
        onSubmit={(e) => { e.preventDefault(); if (!requestMutation.isPending) requestMutation.mutate(); }}
        style={{ display: 'grid', gap: '0.75rem' }}
      >
        <p className="muted">Enter your email and we'll send you a sign-in code.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {requestMutation.isError && <p role="alert" className="muted">{errorMessage(requestMutation.error)}</p>}
        <button type="submit" disabled={requestMutation.isPending} style={accentButton}>
          {requestMutation.isPending ? 'Sending…' : 'Email me a code'}
        </button>
      </form>
    );
  }

  return (
    <form
      className="card"
      onSubmit={(e) => { e.preventDefault(); if (!verifyMutation.isPending) verifyMutation.mutate(); }}
      style={{ display: 'grid', gap: '0.75rem' }}
    >
      <p className="muted">We sent a code to {email}.</p>
      <label>
        Code
        <input value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      {verifyMutation.isError && <p role="alert" className="muted">{errorMessage(verifyMutation.error)}</p>}
      <button type="submit" disabled={verifyMutation.isPending} style={accentButton}>
        {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
      </button>
    </form>
  );
}
