// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSystemKey } from '@club-night/shared';
import { renderWithProviders } from '../setup';
import { CreateNightForm } from '../../src/components/CreateNightForm';
import { apiClient, ApiError } from '../../src/api/client';

const enabledSystems: GameSystemKey[] = ['WARHAMMER_40K', 'BLOOD_BOWL'];

beforeEach(() => vi.restoreAllMocks());

function fill() {
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Thursday Night' } });
  fireEvent.change(screen.getByLabelText(/date & time/i), { target: { value: '2026-07-02T18:00' } });
  fireEvent.change(screen.getByLabelText(/signups close/i), { target: { value: '2026-07-02T12:00' } });
}

describe('CreateNightForm', () => {
  it('creates a night with the chosen systems', async () => {
    const spy = vi.spyOn(apiClient, 'createNight').mockResolvedValue({ nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z', signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT', pairingStrategy: 'RANDOM_WITHIN_SYSTEM', offeredSystems: [{ systemKey: 'BLOOD_BOWL', prominent: false }], createdBy: 'u1' });
    renderWithProviders(<CreateNightForm slug="red-dice" enabledSystems={enabledSystems} />);
    fill();
    await userEvent.click(screen.getByLabelText(/blood bowl/i));
    await userEvent.click(screen.getByRole('button', { name: /create night/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/created/i));
    expect(spy).toHaveBeenCalledWith('red-dice', expect.objectContaining({
      title: 'Thursday Night',
      offeredSystems: [{ systemKey: 'BLOOD_BOWL', prominent: false }],
    }));
    const arg = spy.mock.calls[0]![1];
    expect(arg.eventDate).toMatch(/Z$/);
    expect(arg.signupDeadline).toMatch(/Z$/);
  });

  it('requires at least one system (button disabled until one is picked)', async () => {
    vi.spyOn(apiClient, 'createNight');
    renderWithProviders(<CreateNightForm slug="red-dice" enabledSystems={enabledSystems} />);
    fill();
    expect(screen.getByRole('button', { name: /create night/i })).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/warhammer/i));
    expect(screen.getByRole('button', { name: /create night/i })).toBeEnabled();
  });

  it('shows a not-an-organizer message on 403', async () => {
    vi.spyOn(apiClient, 'createNight').mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not an organizer of this club'));
    renderWithProviders(<CreateNightForm slug="red-dice" enabledSystems={enabledSystems} />);
    fill();
    await userEvent.click(screen.getByLabelText(/warhammer/i));
    await userEvent.click(screen.getByRole('button', { name: /create night/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not an organizer/i));
  });
});
