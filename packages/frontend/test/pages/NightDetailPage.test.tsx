// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import type { GameNight } from '@club-night/shared';
import { renderWithProviders } from '../setup';
import { NightDetailPage } from '../../src/pages/NightDetailPage';
import { apiClient, ApiError } from '../../src/api/client';

const night = (over: Partial<GameNight> = {}): GameNight => ({
  nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT',
  pairingStrategy: 'RANDOM_WITHIN_SYSTEM', offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }], createdBy: 'u1', ...over,
});

beforeEach(() => vi.restoreAllMocks());

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/:slug/nights/:nightId" element={<NightDetailPage />} />
    </Routes>,
    { route: '/red-dice/nights/n1' },
  );
}

describe('NightDetailPage', () => {
  it('shows the night and a signup form when OPEN', async () => {
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(night());
    renderPage();
    await waitFor(() => expect(screen.getByText('Thursday Night')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
  });

  it('shows a closed message when the night is not OPEN', async () => {
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(night({ status: 'PAIRED' }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/signups .* closed/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /sign up/i })).not.toBeInTheDocument();
  });

  it('shows not-found when the night does not exist', async () => {
    vi.spyOn(apiClient, 'getNight').mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Game night not found'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/game night not found/i)).toBeInTheDocument());
  });
});
