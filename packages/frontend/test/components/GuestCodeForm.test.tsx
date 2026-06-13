// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../setup';
import { GuestCodeForm } from '../../src/components/GuestCodeForm';
import { apiClient, ApiError } from '../../src/api/client';

beforeEach(() => vi.restoreAllMocks());

describe('GuestCodeForm', () => {
  it('requests a code then verifies it and calls onAuthed', async () => {
    vi.spyOn(apiClient, 'requestGuestCode').mockResolvedValue();
    vi.spyOn(apiClient, 'verifyGuestCode').mockResolvedValue();
    const onAuthed = vi.fn();
    renderWithProviders(<GuestCodeForm slug="red-dice" onAuthed={onAuthed} />);

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));

    await waitFor(() => expect(screen.getByLabelText(/code/i)).toBeInTheDocument());
    expect(apiClient.requestGuestCode).toHaveBeenCalledWith('red-dice', 'ada@example.com');

    await userEvent.type(screen.getByLabelText(/code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(onAuthed).toHaveBeenCalled());
    expect(apiClient.verifyGuestCode).toHaveBeenCalledWith('red-dice', 'ada@example.com', '123456');
  });

  it('shows an error when the code is invalid', async () => {
    vi.spyOn(apiClient, 'requestGuestCode').mockResolvedValue();
    vi.spyOn(apiClient, 'verifyGuestCode').mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired code'));
    renderWithProviders(<GuestCodeForm slug="red-dice" onAuthed={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
    await waitFor(() => screen.getByLabelText(/code/i));
    await userEvent.type(screen.getByLabelText(/code/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid or expired/i));
  });
});
