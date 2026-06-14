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
import { apiClient } from '../../src/api/client';
import type { Club, GameNight } from '@club-night/shared';

beforeEach(() => { vi.restoreAllMocks(); setToken(null); });

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/:slug/organize" element={<OrganizerPage />} />
    </Routes>,
    { route: '/red-dice/organize' },
  );
}

const club: Club = { clubId: 'c1', slug: 'red-dice', name: 'Red Dice Club', logoUrl: 'l', primaryColour: '#B22222', enabledSystems: ['WARHAMMER_40K', 'BLOOD_BOWL'] };
const night: GameNight = { nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z', signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT', pairingStrategy: 'RANDOM_WITHIN_SYSTEM', offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }], createdBy: 'u1' };

describe('OrganizerPage', () => {
  it('shows the login form when not signed in', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows the organizer area after signing in', async () => {
    vi.spyOn(cognitoAuth, 'signIn').mockResolvedValue({ challenge: 'NONE', idToken: 'id-token-123' });
    vi.spyOn(apiClient, 'getClub').mockResolvedValue(club);
    vi.spyOn(apiClient, 'listNights').mockResolvedValue([night]);
    renderPage();
    await userEvent.type(screen.getByLabelText(/email/i), 'olivia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /organize/i })).toBeInTheDocument());
  });

  it('shows the organizer area immediately when a token is already stored', () => {
    setToken('id-token-123');
    vi.spyOn(apiClient, 'getClub').mockResolvedValue(club);
    vi.spyOn(apiClient, 'listNights').mockResolvedValue([night]);
    renderPage();
    expect(screen.getByRole('heading', { name: /organize/i })).toBeInTheDocument();
  });
});

describe('OrganizerPage dashboard', () => {
  beforeEach(() => {
    setToken('id-token-123');
    vi.spyOn(apiClient, 'getClub').mockResolvedValue(club);
    vi.spyOn(apiClient, 'listNights').mockResolvedValue([night]);
  });

  it('renders the create-night form and the nights list', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: /create a game night/i })).toBeInTheDocument());
    expect(screen.getByText('Thursday Night')).toBeInTheDocument();
  });

  it('cancels a night', async () => {
    const cancel = vi.spyOn(apiClient, 'updateNight').mockResolvedValue({ ...night, status: 'CANCELLED' });
    renderPage();
    await waitFor(() => expect(screen.getByText('Thursday Night')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('red-dice', 'n1', { status: 'CANCELLED' }));
  });
});
