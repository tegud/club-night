import { useParams, Link } from 'react-router-dom';
import { useNights } from '../club/useClub';

export function ClubHomePage() {
  const { slug = '' } = useParams();
  const { data: nights, isLoading, isError } = useNights(slug);

  if (isLoading) return <p>Loading nights…</p>;
  if (isError) return <p className="muted">Could not load game nights.</p>;
  if (!nights || nights.length === 0) return <p className="muted">No upcoming game nights yet.</p>;

  return (
    <section>
      <h2>Upcoming game nights</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.75rem' }}>
        {nights.map((night) => (
          <li key={night.nightId} className="card">
            <Link to={`/c/${slug}/nights/${night.nightId}`} style={{ fontWeight: 600 }}>
              {night.title}
            </Link>
            <div className="muted">{new Date(night.eventDate).toLocaleString()}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
