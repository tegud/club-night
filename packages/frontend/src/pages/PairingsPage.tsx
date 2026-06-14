import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getToken, setToken } from '../auth/token';
import { signOut } from '../auth/cognito-auth';
import { useNight, usePairings } from '../club/useClub';
import { apiClient } from '../api/client';
import { LoginForm } from '../components/LoginForm';
import { errorMessage } from '../lib/errors';
import { GAME_SYSTEM_NAMES } from '@club-night/shared';
import type { Pairing } from '@club-night/shared';

const accentButton = { background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' } as const;

function OddRow({
  pairing,
  otherUnresolved,
  onResolve,
}: {
  pairing: Pairing;
  otherUnresolved: Pairing[];
  onResolve: (pairingId: string, opponentSignupId: string) => void;
}) {
  const [chosen, setChosen] = useState('');
  const player = pairing.players[0]!;
  const selectId = `opponent-for-${player.playerName.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <li className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <span>
        <strong>{player.playerName}</strong>{' '}
        <span className="muted">· {GAME_SYSTEM_NAMES[pairing.systemKey]} · needs resolution</span>
      </span>
      {otherUnresolved.length === 0 ? (
        <span className="muted">No available opponent</span>
      ) : (
        <>
          <select
            id={selectId}
            aria-label={`Opponent for ${player.playerName}`}
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            <option value="">— choose opponent —</option>
            {otherUnresolved.map((other) => (
              <option key={other.players[0]!.signupId} value={other.players[0]!.signupId}>
                {other.players[0]!.playerName}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={chosen === ''}
            onClick={() => onResolve(pairing.pairingId, chosen)}
          >
            Resolve
          </button>
        </>
      )}
    </li>
  );
}

export function PairingsPage() {
  const { slug = '', nightId = '' } = useParams();
  const [loggedIn, setLoggedIn] = useState(() => getToken() !== null);
  const queryClient = useQueryClient();

  const nightQ = useNight(slug, nightId);
  const pairingsQ = usePairings(slug, nightId);

  const generateMutation = useMutation({
    mutationFn: () => apiClient.generatePairings(slug, nightId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pairings', slug, nightId] });
      queryClient.invalidateQueries({ queryKey: ['night', slug, nightId] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ pairingId, opponentSignupId }: { pairingId: string; opponentSignupId: string }) =>
      apiClient.resolvePairing(slug, nightId, pairingId, opponentSignupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pairings', slug, nightId] });
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => apiClient.publishPairings(slug, nightId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pairings', slug, nightId] });
      queryClient.invalidateQueries({ queryKey: ['night', slug, nightId] });
    },
  });

  if (!loggedIn) {
    return (
      <section>
        <h2>Organizer sign-in</h2>
        <LoginForm onLoggedIn={() => setLoggedIn(true)} />
      </section>
    );
  }

  const night = nightQ.data;
  const pairings = pairingsQ.data ?? [];
  const needsResolution = pairings.filter((p) => p.status === 'NEEDS_RESOLUTION');
  const matched = pairings.filter((p) => p.status === 'MATCHED');

  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{night?.title ?? 'Pairings'}</h2>
        <span style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link to={`/${slug}/organize`}>← Back</Link>
          <button
            type="button"
            className="muted"
            style={{ background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => {
              try { signOut(); } finally {
                setToken(null);
                setLoggedIn(false);
              }
            }}
          >
            Sign out
          </button>
        </span>
      </header>

      {night?.status === 'OPEN' && (
        <div>
          <p>Signups are open. Generate random within-system pairings to close signups and move to the pairings stage.</p>
          {generateMutation.isError && (
            <p role="alert">{errorMessage(generateMutation.error)}</p>
          )}
          <button
            type="button"
            style={accentButton}
            disabled={generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
          >
            Generate pairings
          </button>
        </div>
      )}

      {night?.status === 'CLOSED' && (
        <div>
          {matched.length > 0 && (
            <>
              <h3>Matched pairings</h3>
              <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
                {matched.map((p) => (
                  <li key={p.pairingId} className="card">
                    <strong>{p.players[0]!.playerName}</strong>
                    {' vs '}
                    <strong>{p.players[1]!.playerName}</strong>
                    {' · '}
                    <span>{GAME_SYSTEM_NAMES[p.systemKey]}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {needsResolution.length > 0 && (
            <>
              <h3>Needs resolution</h3>
              <p role="alert" className="muted">
                Unresolved players won't be emailed when you publish, but you can still publish.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
                {needsResolution.map((p) => (
                  <OddRow
                    key={p.pairingId}
                    pairing={p}
                    otherUnresolved={needsResolution.filter((o) => o.pairingId !== p.pairingId)}
                    onResolve={(pairingId, opponentSignupId) =>
                      resolveMutation.mutate({ pairingId, opponentSignupId })
                    }
                  />
                ))}
              </ul>
            </>
          )}

          {resolveMutation.isError && (
            <p role="alert">{errorMessage(resolveMutation.error)}</p>
          )}
          {generateMutation.isError && (
            <p role="alert">{errorMessage(generateMutation.error)}</p>
          )}
          {publishMutation.isError && (
            <p role="alert">{errorMessage(publishMutation.error)}</p>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              Re-roll pairings
            </button>
            <button
              type="button"
              style={accentButton}
              disabled={publishMutation.isPending}
              onClick={() => publishMutation.mutate()}
            >
              Publish
            </button>
          </div>
        </div>
      )}

      {night?.status === 'PAIRED' && (
        <div>
          <p className="muted">
            <strong>Published</strong> — pairings have been sent to players.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
            {pairings.filter((p) => p.status === 'MATCHED').map((p) => (
              <li key={p.pairingId} className="card">
                <strong>{p.players[0]!.playerName}</strong>
                {' vs '}
                <strong>{p.players[1]!.playerName}</strong>
                {' · '}
                <span>{GAME_SYSTEM_NAMES[p.systemKey]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!night && nightQ.isLoading && <p>Loading…</p>}
    </section>
  );
}
