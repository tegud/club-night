// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './setup';
import { ClubShell } from '../src/club/ClubShell';
import { ClubHomePage } from '../src/pages/ClubHomePage';
import { apiClient } from '../src/api/client';

const club = { clubId: 'c1', slug: 'red-dice', name: 'Red Dice Club', logoUrl: 'https://x/logo.png', primaryColour: '#B22222', enabledSystems: ['WARHAMMER_40K' as const] };

beforeEach(() => vi.restoreAllMocks());

describe('App routing', () => {
  it('renders the club home page at /c/:slug', async () => {
    vi.spyOn(apiClient, 'getClub').mockResolvedValue(club);
    vi.spyOn(apiClient, 'listNights').mockResolvedValue([]);
    renderWithProviders(
      <Routes>
        <Route path="/c/:slug" element={<ClubShell />}>
          <Route index element={<ClubHomePage />} />
        </Route>
      </Routes>,
      { route: '/c/red-dice' },
    );
    await waitFor(() => expect(screen.getByText(/no upcoming game nights/i)).toBeInTheDocument());
  });
});
