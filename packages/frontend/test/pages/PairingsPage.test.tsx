// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../setup';
import { PairingsPage } from '../../src/pages/PairingsPage';
import { setToken } from '../../src/auth/token';
import { apiClient } from '../../src/api/client';
import type { GameNight, Pairing } from '@club-night/shared';

beforeEach(() => {
  vi.restoreAllMocks();
  setToken('id-token-123');
});

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/:slug/nights/:nightId/organize" element={<PairingsPage />} />
    </Routes>,
    { route: '/red-dice/nights/n1/organize' },
  );
}

const openNight: GameNight = {
  nightId: 'n1',
  clubId: 'c1',
  title: 'Thursday Night',
  eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z',
  status: 'OPEN',
  eventType: 'SCHEDULED_GAME_NIGHT',
  pairingStrategy: 'RANDOM_WITHIN_SYSTEM',
  offeredSystems: [],
  createdBy: 'u1',
};
const closedNight = { ...openNight, status: 'CLOSED' as const };
const pairedNight = { ...openNight, status: 'PAIRED' as const };

const matched: Pairing = {
  pairingId: 'p1',
  nightId: 'n1',
  clubId: 'c1',
  systemKey: 'WARHAMMER_40K',
  players: [{ signupId: 's1', playerName: 'Ada' }, { signupId: 's2', playerName: 'Ben' }],
  status: 'MATCHED',
};
const odd1: Pairing = {
  pairingId: 'p2',
  nightId: 'n1',
  clubId: 'c1',
  systemKey: 'BLOOD_BOWL',
  players: [{ signupId: 's3', playerName: 'Cleo' }],
  status: 'NEEDS_RESOLUTION',
};
const odd2: Pairing = {
  pairingId: 'p3',
  nightId: 'n1',
  clubId: 'c1',
  systemKey: 'WARHAMMER_40K',
  players: [{ signupId: 's4', playerName: 'Dot' }],
  status: 'NEEDS_RESOLUTION',
};

describe('PairingsPage', () => {
  it('OPEN → shows Generate pairings button; clicking it calls generatePairings', async () => {
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(openNight);
    vi.spyOn(apiClient, 'listPairings').mockResolvedValue([]);
    const generateSpy = vi.spyOn(apiClient, 'generatePairings').mockResolvedValue([matched]);

    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: /generate pairings/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /generate pairings/i }));

    await waitFor(() => expect(generateSpy).toHaveBeenCalledWith('red-dice', 'n1'));
  });

  it('CLOSED → renders MATCHED pairing players and system name', async () => {
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(closedNight);
    vi.spyOn(apiClient, 'listPairings').mockResolvedValue([matched]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
    expect(screen.getByText('Ben')).toBeInTheDocument();
    expect(screen.getByText(/warhammer 40,000/i)).toBeInTheDocument();
  });

  it('CLOSED with odd ones → resolve calls resolvePairing with correct args', async () => {
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(closedNight);
    vi.spyOn(apiClient, 'listPairings').mockResolvedValue([odd1, odd2]);
    const resolveSpy = vi.spyOn(apiClient, 'resolvePairing').mockResolvedValue({
      ...odd1,
      players: [odd1.players[0]!, odd2.players[0]!],
      status: 'MATCHED',
    });

    renderPage();

    // The row for Cleo (odd1) should have a select listing Dot (odd2's player)
    await waitFor(() => expect(screen.getByRole('combobox', { name: /opponent for cleo/i })).toBeInTheDocument());
    const select = screen.getByRole('combobox', { name: /opponent for cleo/i });
    await userEvent.selectOptions(select, 's4');

    const resolveBtn = screen.getAllByRole('button', { name: /resolve/i })[0]!;
    await userEvent.click(resolveBtn);

    await waitFor(() => expect(resolveSpy).toHaveBeenCalledWith('red-dice', 'n1', 'p2', 's4'));
  });

  it('CLOSED → Publish button calls publishPairings', async () => {
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(closedNight);
    vi.spyOn(apiClient, 'listPairings').mockResolvedValue([matched]);
    const publishSpy = vi.spyOn(apiClient, 'publishPairings').mockResolvedValue({ night: pairedNight, pairings: [matched] });

    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /publish/i }));

    await waitFor(() => expect(publishSpy).toHaveBeenCalledWith('red-dice', 'n1'));
  });

  it('PAIRED → shows Published view, no Publish/Generate buttons', async () => {
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(pairedNight);
    vi.spyOn(apiClient, 'listPairings').mockResolvedValue([matched]);

    renderPage();

    await waitFor(() => expect(screen.getByText(/published/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
  });
});
