// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import type { GameNight, Signup } from '@club-night/shared';
import { renderWithProviders } from '../setup';
import { ManageSignupPage } from '../../src/pages/ManageSignupPage';
import { apiClient } from '../../src/api/client';
import { setToken } from '../../src/auth/token';

const night: GameNight = {
  nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT',
  pairingStrategy: 'RANDOM_WITHIN_SYSTEM',
  offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }, { systemKey: 'BLOOD_BOWL', prominent: false }], createdBy: 'u1',
};
const signup: Signup = { signupId: 's1', nightId: 'n1', clubId: 'c1', playerName: 'Ada', email: 'ada@example.com', systemKey: 'WARHAMMER_40K', status: 'CONFIRMED' };

beforeEach(() => { vi.restoreAllMocks(); setToken(null); });

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/:slug/nights/:nightId/manage" element={<ManageSignupPage />} />
    </Routes>,
    { route: '/red-dice/nights/n1/manage' },
  );
}

describe('ManageSignupPage', () => {
  it('shows the sign-in form when there is no token', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /email me a code/i })).toBeInTheDocument();
  });

  it('shows the signup and lets the guest withdraw when authed', async () => {
    setToken('guest-tok');
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(night);
    vi.spyOn(apiClient, 'getMySignup').mockResolvedValue(signup);
    const withdraw = vi.spyOn(apiClient, 'withdrawSignup').mockResolvedValue({ ...signup, status: 'CANCELLED' });
    renderPage();
    await waitFor(() => expect(screen.getByText(/your signup/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /withdraw/i }));
    await waitFor(() => expect(screen.getByText(/withdrawn/i)).toBeInTheDocument());
    expect(withdraw).toHaveBeenCalledWith('red-dice', 'n1', 's1');
  });

  it('shows a not-found message when the guest has no signup', async () => {
    setToken('guest-tok');
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(night);
    const { ApiError } = await import('../../src/api/client');
    vi.spyOn(apiClient, 'getMySignup').mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'No signup found'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/no signup found/i)).toBeInTheDocument());
  });

  it('lets the guest change the system and save', async () => {
    setToken('guest-tok');
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(night);
    vi.spyOn(apiClient, 'getMySignup').mockResolvedValue(signup);
    const update = vi.spyOn(apiClient, 'updateSignup').mockResolvedValue({ ...signup, systemKey: 'BLOOD_BOWL' });
    renderPage();
    await waitFor(() => expect(screen.getByText(/your signup/i)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/game system/i), 'BLOOD_BOWL');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument());
    expect(update).toHaveBeenCalledWith('red-dice', 'n1', 's1', expect.objectContaining({ systemKey: 'BLOOD_BOWL' }));
  });

  it('returns to sign-in when the session has expired (401)', async () => {
    setToken('expired-tok');
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(night);
    const { ApiError } = await import('../../src/api/client');
    vi.spyOn(apiClient, 'getMySignup').mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /email me a code/i })).toBeInTheDocument());
  });
});
