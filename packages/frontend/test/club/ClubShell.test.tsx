// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../setup';
import { ClubShell } from '../../src/club/ClubShell';
import { apiClient } from '../../src/api/client';

beforeEach(() => vi.restoreAllMocks());

const club = { clubId: 'c1', slug: 'red-dice', name: 'Red Dice Club', logoUrl: 'https://x/logo.png', primaryColour: '#B22222', enabledSystems: ['WARHAMMER_40K' as const] };

describe('ClubShell', () => {
  it('renders the club name + logo and applies the accent colour', async () => {
    vi.spyOn(apiClient, 'getClub').mockResolvedValue(club);
    renderWithProviders(
      <Routes>
        <Route path="/c/:slug" element={<ClubShell />}>
          <Route index element={<p>inner</p>} />
        </Route>
      </Routes>,
      { route: '/c/red-dice' },
    );
    await waitFor(() => expect(screen.getByText('Red Dice Club')).toBeInTheDocument());
    expect(screen.getByRole('img', { name: /red dice club/i })).toHaveAttribute('src', 'https://x/logo.png');
    expect(document.documentElement.style.getPropertyValue('--club-accent')).toBe('#B22222');
    expect(screen.getByText('inner')).toBeInTheDocument();
  });

  it('shows a not-found message when the club does not exist', async () => {
    const { ApiError } = await import('../../src/api/client');
    vi.spyOn(apiClient, 'getClub').mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Club not found'));
    renderWithProviders(
      <Routes>
        <Route path="/c/:slug" element={<ClubShell />} />
      </Routes>,
      { route: '/c/missing' },
    );
    await waitFor(() => expect(screen.getByText(/club not found/i)).toBeInTheDocument());
  });
});
