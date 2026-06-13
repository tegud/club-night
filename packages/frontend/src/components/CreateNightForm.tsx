import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GAME_SYSTEM_NAMES, type GameSystemKey } from '@club-night/shared';
import { apiClient, ApiError } from '../api/client';
import { errorMessage } from '../lib/errors';

const accentButton = { background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' } as const;

function createError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return "You're not an organizer of this club.";
  return errorMessage(error);
}

export function CreateNightForm({ slug, enabledSystems }: { slug: string; enabledSystems: GameSystemKey[] }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [signupDeadline, setSignupDeadline] = useState('');
  const [selected, setSelected] = useState<GameSystemKey[]>([]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createNight(slug, {
        title,
        eventDate: new Date(eventDate).toISOString(),
        signupDeadline: new Date(signupDeadline).toISOString(),
        offeredSystems: selected.map((systemKey) => ({ systemKey, prominent: false })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nights', slug] });
      setTitle('');
      setEventDate('');
      setSignupDeadline('');
      setSelected([]);
    },
  });

  const toggle = (key: GameSystemKey) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const canSubmit =
    !mutation.isPending && selected.length > 0 && title.trim() !== '' && eventDate !== '' && signupDeadline !== '';

  return (
    <form
      className="card"
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }}
      style={{ display: 'grid', gap: '0.75rem' }}
    >
      <h3>Create a game night</h3>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
      <label>Date &amp; time<input type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required /></label>
      <label>Signups close<input type="datetime-local" value={signupDeadline} onChange={(e) => setSignupDeadline(e.target.value)} required /></label>
      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
        <legend>Game systems</legend>
        {enabledSystems.map((key) => (
          <label key={key} style={{ display: 'block' }}>
            <input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} /> {GAME_SYSTEM_NAMES[key]}
          </label>
        ))}
      </fieldset>
      {selected.length === 0 && <p className="muted">Pick at least one game system.</p>}
      {mutation.isError && <p role="alert" className="muted">{createError(mutation.error)}</p>}
      {mutation.isSuccess && <p role="status" className="muted">Night created.</p>}
      <button type="submit" disabled={!canSubmit} style={accentButton}>
        {mutation.isPending ? 'Creating…' : 'Create night'}
      </button>
    </form>
  );
}
