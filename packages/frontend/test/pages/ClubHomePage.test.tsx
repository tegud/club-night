// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../setup';
import { ClubShell } from '../../src/club/ClubShell';
import { ClubHomePage } from '../../src/pages/ClubHomePage';
import { apiClient } from '../../src/api/client';

const club = { clubId: 'c1', slug: 'red-dice', name: 'Red Dice Club', logoUrl: 'https://x/logo.png', primaryColour: '#B22222', enabledSystems: ['WARHAMMER_40K' as const] };
const night = {
  nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN' as const, eventType: 'SCHEDULED_GAME_NIGHT' as const,
  pairingStrategy: 'RANDOM_WITHIN_SYSTEM' as const, offeredSystems: [{ systemKey: 'WARHAMMER_40K' as const, prominent: true }], createdBy: 'u1',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(apiClient, 'getClub').mockResolvedValue(club);
});

function renderHome() {
  return renderWithProviders(
    <Routes>
      <Route path="/c/:slug" element={<ClubShell />}>
        <Route index element={<ClubHomePage />} />
      </Route>
    </Routes>,
    { route: '/c/red-dice' },
  );
}

describe('ClubHomePage', () => {
  it('lists upcoming nights', async () => {
    vi.spyOn(apiClient, 'listNights').mockResolvedValue([night]);
    renderHome();
    await waitFor(() => expect(screen.getByText('Thursday Night')).toBeInTheDocument());
  });

  it('shows an empty state when there are no nights', async () => {
    vi.spyOn(apiClient, 'listNights').mockResolvedValue([]);
    renderHome();
    await waitFor(() => expect(screen.getByText(/no upcoming game nights/i)).toBeInTheDocument());
  });

  it('shows an error state when nights fail to load', async () => {
    vi.spyOn(apiClient, 'listNights').mockRejectedValue(new Error('network'));
    renderHome();
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument());
  });
});
