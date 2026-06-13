import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GAME_SYSTEM_NAMES, type GameSystemKey } from '@club-night/shared';
import { useMySignup, useNight } from '../club/useClub';
import { apiClient, ApiError } from '../api/client';
import { getToken } from '../auth/token';
import { GuestCodeForm } from '../components/GuestCodeForm';
import { errorMessage } from '../lib/errors';

const accentButton = { background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.5rem 0.9rem', cursor: 'pointer' } as const;

export function ManageSignupPage() {
  const { slug = '', nightId = '' } = useParams();
  const [authed, setAuthed] = useState(() => getToken() !== null);
  const queryClient = useQueryClient();

  const nightQ = useNight(slug, nightId);
  const signupQ = useMySignup(slug, nightId, authed);

  const [systemKey, setSystemKey] = useState<GameSystemKey | ''>('');
  const [note, setNote] = useState('');
  const [initialised, setInitialised] = useState(false);
  if (signupQ.data && !initialised) {
    setSystemKey(signupQ.data.systemKey);
    setNote(signupQ.data.note ?? '');
    setInitialised(true);
  }

  const updateMutation = useMutation({
    mutationFn: () => apiClient.updateSignup(slug, nightId, signupQ.data!.signupId, { systemKey: systemKey as GameSystemKey, note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-signup', slug, nightId] }),
  });
  const withdrawMutation = useMutation({
    mutationFn: () => apiClient.withdrawSignup(slug, nightId, signupQ.data!.signupId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-signup', slug, nightId] }),
  });

  const sessionExpired = signupQ.isError && signupQ.error instanceof ApiError && signupQ.error.status === 401;

  if (!authed || sessionExpired) {
    return (
      <section>
        <h2>Manage your signup</h2>
        {sessionExpired && <p className="muted">Your session expired — please sign in again.</p>}
        <GuestCodeForm
          slug={slug}
          onAuthed={() => {
            setAuthed(true);
            queryClient.invalidateQueries({ queryKey: ['my-signup', slug, nightId] });
          }}
        />
      </section>
    );
  }

  if (signupQ.isLoading || nightQ.isLoading) return <p>Loading…</p>;
  if (signupQ.isError && signupQ.error instanceof ApiError && signupQ.error.status === 404) {
    return (
      <section>
        <h2>Manage your signup</h2>
        <p className="muted">No signup found for your email on this night.</p>
      </section>
    );
  }
  if (!signupQ.data || !nightQ.data) return <p className="muted">Could not load your signup.</p>;

  if (withdrawMutation.isSuccess || signupQ.data?.status === 'CANCELLED') {
    return <section><h2>Manage your signup</h2><p className="muted">Your signup has been withdrawn.</p></section>;
  }

  return (
    <section>
      <h2>Your signup</h2>
      <form
        className="card"
        onSubmit={(e) => { e.preventDefault(); if (!updateMutation.isPending) updateMutation.mutate(); }}
        style={{ display: 'grid', gap: '0.75rem' }}
      >
        <label>
          Game system
          <select value={systemKey} onChange={(e) => setSystemKey(e.target.value as GameSystemKey)}>
            {nightQ.data.offeredSystems.map((s) => (
              <option key={s.systemKey} value={s.systemKey}>{GAME_SYSTEM_NAMES[s.systemKey]}</option>
            ))}
          </select>
        </label>
        <label>
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {updateMutation.isError && (
          <p role="alert" className="muted">
            {errorMessage(updateMutation.error)}
          </p>
        )}
        {updateMutation.isSuccess && <p role="status" className="muted">Saved.</p>}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit" disabled={updateMutation.isPending} style={accentButton}>Save changes</button>
          <button
            type="button"
            onClick={() => { if (!withdrawMutation.isPending) withdrawMutation.mutate(); }}
            disabled={withdrawMutation.isPending}
            style={{ ...accentButton, background: '#b91c1c' }}
          >
            Withdraw
          </button>
        </div>
      </form>
    </section>
  );
}
