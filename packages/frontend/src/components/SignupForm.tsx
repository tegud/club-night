import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { GAME_SYSTEM_NAMES, type GameNight, type GameSystemKey } from '@club-night/shared';
import { apiClient, ApiError } from '../api/client';

export function SignupForm({ slug, night }: { slug: string; night: GameNight }) {
  const [playerName, setPlayerName] = useState('');
  const [email, setEmail] = useState('');
  const [systemKey, setSystemKey] = useState<GameSystemKey>(night.offeredSystems[0]!.systemKey);
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createSignup(slug, night.nightId, { playerName, email, systemKey, ...(note ? { note } : {}) }),
  });

  if (mutation.isSuccess) {
    return (
      <div className="card" role="status">
        <strong>You're signed up!</strong>
        <p className="muted">Playing {GAME_SYSTEM_NAMES[mutation.data.systemKey]} at {night.title}.</p>
      </div>
    );
  }

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!mutation.isPending) mutation.mutate();
      }}
      style={{ display: 'grid', gap: '0.75rem' }}
    >
      <label>
        Name
        <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} required />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Game system
        <select value={systemKey} onChange={(e) => setSystemKey(e.target.value as GameSystemKey)}>
          {night.offeredSystems.map((s) => (
            <option key={s.systemKey} value={s.systemKey}>
              {GAME_SYSTEM_NAMES[s.systemKey]}
              {s.prominent ? ' ★' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {mutation.isError && (
        <p role="alert" className="muted">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Something went wrong'}
        </p>
      )}
      <button type="submit" disabled={mutation.isPending} style={{ background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' }}>
        {mutation.isPending ? 'Signing up…' : 'Sign up'}
      </button>
    </form>
  );
}
