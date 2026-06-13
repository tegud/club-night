// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameNight } from '@club-night/shared';
import { renderWithProviders } from '../setup';
import { SignupForm } from '../../src/components/SignupForm';
import { apiClient, ApiError } from '../../src/api/client';

const night: GameNight = {
  nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT',
  pairingStrategy: 'RANDOM_WITHIN_SYSTEM',
  offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }, { systemKey: 'BLOOD_BOWL', prominent: false }],
  createdBy: 'u1',
};

beforeEach(() => vi.restoreAllMocks());

describe('SignupForm', () => {
  it('submits a signup and shows confirmation', async () => {
    const spy = vi.spyOn(apiClient, 'createSignup').mockResolvedValue({ signupId: 's1', nightId: 'n1', clubId: 'c1', playerName: 'Ada', email: 'ada@example.com', systemKey: 'BLOOD_BOWL', status: 'CONFIRMED' });
    renderWithProviders(<SignupForm slug="red-dice" night={night} />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Ada');
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.selectOptions(screen.getByLabelText(/game system/i), 'BLOOD_BOWL');
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/signed up/i));
    expect(spy).toHaveBeenCalledWith('red-dice', 'n1', expect.objectContaining({ playerName: 'Ada', email: 'ada@example.com', systemKey: 'BLOOD_BOWL' }));
  });

  it('shows the error message when the night is not open', async () => {
    vi.spyOn(apiClient, 'createSignup').mockRejectedValue(new ApiError(409, 'CONFLICT', 'This game night is not open for signups'));
    renderWithProviders(<SignupForm slug="red-dice" night={night} />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Ada');
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not open/i));
  });

  it('disables the button while the signup is in flight', async () => {
    vi.spyOn(apiClient, 'createSignup').mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SignupForm slug="red-dice" night={night} />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Ada');
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));
    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());
    expect(screen.getByRole('button')).toHaveTextContent(/signing up/i);
  });
});
