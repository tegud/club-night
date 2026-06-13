// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../setup';
import { OrganizerPage } from '../../src/pages/OrganizerPage';
import * as cognitoAuth from '../../src/auth/cognito-auth';
import { setToken } from '../../src/auth/token';

beforeEach(() => { vi.restoreAllMocks(); setToken(null); });

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/c/:slug/organize" element={<OrganizerPage />} />
    </Routes>,
    { route: '/c/red-dice/organize' },
  );
}

describe('OrganizerPage', () => {
  it('shows the login form when not signed in', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows the organizer area after signing in', async () => {
    vi.spyOn(cognitoAuth, 'signIn').mockResolvedValue('id-token-123');
    renderPage();
    await userEvent.type(screen.getByLabelText(/email/i), 'olivia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /organize/i })).toBeInTheDocument());
  });

  it('shows the organizer area immediately when a token is already stored', () => {
    setToken('id-token-123');
    renderPage();
    expect(screen.getByRole('heading', { name: /organize/i })).toBeInTheDocument();
  });
});
