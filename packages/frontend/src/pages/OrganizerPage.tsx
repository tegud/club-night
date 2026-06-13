import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getToken, setToken } from '../auth/token';
import { signOut } from '../auth/cognito-auth';
import { useClub, useNights } from '../club/useClub';
import { apiClient } from '../api/client';
import { LoginForm } from '../components/LoginForm';
import { CreateNightForm } from '../components/CreateNightForm';

export function OrganizerPage() {
  const { slug = '' } = useParams();
  // TODO(5d-ii): getToken() is also non-null for a stored GUEST token; a guest token will 403
  // on organizer calls — the create-night form surfaces that clearly ("not an organizer").
  const [loggedIn, setLoggedIn] = useState(() => getToken() !== null);
  const queryClient = useQueryClient();

  const clubQ = useClub(slug);
  const nightsQ = useNights(slug);
  const cancelMutation = useMutation({
    mutationFn: (nightId: string) => apiClient.updateNight(slug, nightId, { status: 'CANCELLED' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nights', slug] }),
  });

  if (!loggedIn) {
    return (
      <section>
        <h2>Organizer sign-in</h2>
        <LoginForm onLoggedIn={() => setLoggedIn(true)} />
      </section>
    );
  }

  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Organize {clubQ.data?.name ?? slug}</h2>
        <button
          type="button"
          className="muted"
          style={{ background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => {
            try {
              signOut();
            } finally {
              setToken(null);
              setLoggedIn(false);
            }
          }}
        >
          Sign out
        </button>
      </header>

      {clubQ.data && <CreateNightForm slug={slug} enabledSystems={clubQ.data.enabledSystems} />}

      <h3 style={{ marginTop: '1.5rem' }}>Nights</h3>
      {nightsQ.isLoading && <p>Loading nights…</p>}
      {nightsQ.data && nightsQ.data.length === 0 && <p className="muted">No upcoming nights yet.</p>}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
        {nightsQ.data?.map((night) => (
          <li key={night.nightId} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <span>
              <strong>{night.title}</strong> <span className="muted">· {night.status}</span>
            </span>
            <span style={{ display: 'flex', gap: '0.75rem' }}>
              <Link to={`/c/${slug}/nights/${night.nightId}/organize`}>Pairings</Link>
              <button
                type="button"
                onClick={() => cancelMutation.mutate(night.nightId)}
                disabled={cancelMutation.isPending && cancelMutation.variables === night.nightId}
                style={{ background: 'none', border: 0, color: '#b91c1c', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
