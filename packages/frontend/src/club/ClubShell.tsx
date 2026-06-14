import { useEffect } from 'react';
import { useParams, Outlet } from 'react-router-dom';
import { useClub } from './useClub';

export function ClubShell() {
  const { slug = '' } = useParams();
  const { data: club, isLoading, isError } = useClub(slug);

  useEffect(() => {
    if (!club) return;
    document.documentElement.style.setProperty('--club-accent', club.primaryColour);
    return () => { document.documentElement.style.removeProperty('--club-accent'); };
  }, [club]);

  if (isLoading) return <div className="container">Loading…</div>;
  if (isError || !club) return <div className="container">Club not found</div>;

  return (
    <>
      <div className="accent-bar" />
      <div className="container">
        <header style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {club.logoUrl && (
            <img src={club.logoUrl} alt={club.name} style={{ height: 48, width: 48, objectFit: 'contain' }} />
          )}
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{club.name}</h1>
        </header>
        <Outlet context={{ slug }} />
      </div>
    </>
  );
}
