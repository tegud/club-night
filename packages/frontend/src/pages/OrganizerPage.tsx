import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getToken, setToken } from '../auth/token';
import { signOut } from '../auth/cognito-auth';
import { LoginForm } from '../components/LoginForm';

export function OrganizerPage() {
  const { slug = '' } = useParams();
  // TODO(5d-ii): getToken() is also non-null for a stored GUEST token. Once the dashboard
  // makes organizer API calls, a guest token will 403 — handle that by showing LoginForm
  // (the Cognito sign-in overwrites the token with an organizer ID token).
  const [loggedIn, setLoggedIn] = useState(() => getToken() !== null);

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
        <h2>Organize {slug}</h2>
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
      <p className="muted">Night management and pairings are coming next.</p>
    </section>
  );
}
