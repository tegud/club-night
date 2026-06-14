import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useNight } from '../club/useClub';
import { SignupForm } from '../components/SignupForm';

export function NightDetailPage() {
  const { slug = '', nightId = '' } = useParams();
  const { data: night, isLoading, isError } = useNight(slug, nightId);

  if (isLoading) return <p>Loading night…</p>;
  if (isError || !night) return <p className="muted">Game night not found.</p>;

  return (
    <section>
      <h2>{night.title}</h2>
      <p className="muted">
        {new Date(night.eventDate).toLocaleString()} · signups close {new Date(night.signupDeadline).toLocaleString()}
      </p>
      {night.status === 'OPEN' ? (
        <SignupForm slug={slug} night={night} />
      ) : (
        <p className="muted">Signups for this night are closed.</p>
      )}
      <p className="muted" style={{ marginTop: '1rem' }}>
        Already signed up? <Link to={`/${slug}/nights/${nightId}/manage`}>Manage your signup</Link>
      </p>
    </section>
  );
}
