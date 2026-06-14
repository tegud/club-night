// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../setup';
import { LoginForm } from '../../src/components/LoginForm';
import * as cognitoAuth from '../../src/auth/cognito-auth';
import { getToken, setToken } from '../../src/auth/token';

beforeEach(() => { vi.restoreAllMocks(); setToken(null); });

describe('LoginForm', () => {
  it('signs in, stores the ID token, and calls onLoggedIn', async () => {
    vi.spyOn(cognitoAuth, 'signIn').mockResolvedValue({ challenge: 'NONE', idToken: 'id-token-123' });
    const onLoggedIn = vi.fn();
    renderWithProviders(<LoginForm onLoggedIn={onLoggedIn} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'olivia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(cognitoAuth.signIn).toHaveBeenCalledWith('olivia@example.com', 'hunter2!');
    expect(getToken()).toBe('id-token-123');
  });

  it('prompts for a new password on the FORCE_CHANGE_PASSWORD challenge, then signs in', async () => {
    const completeNewPassword = vi.fn().mockResolvedValue('id-token-after-reset');
    vi.spyOn(cognitoAuth, 'signIn').mockResolvedValue({ challenge: 'NEW_PASSWORD_REQUIRED', completeNewPassword });
    const onLoggedIn = vi.fn();
    renderWithProviders(<LoginForm onLoggedIn={onLoggedIn} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'olivia@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Temp-Pass-1!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // The form switches to the new-password step.
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());
    expect(onLoggedIn).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/new password/i), 'Brand-New-Pass-9!');
    await userEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(completeNewPassword).toHaveBeenCalledWith('Brand-New-Pass-9!');
    expect(getToken()).toBe('id-token-after-reset');
  });

  it('shows an error when sign-in fails', async () => {
    vi.spyOn(cognitoAuth, 'signIn').mockRejectedValue(new Error('Incorrect username or password.'));
    renderWithProviders(<LoginForm onLoggedIn={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'olivia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/incorrect/i));
  });

  it('disables the button while sign-in is pending', async () => {
    vi.spyOn(cognitoAuth, 'signIn').mockReturnValue(new Promise(() => {}));
    renderWithProviders(<LoginForm onLoggedIn={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'olivia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());
    expect(screen.getByRole('button')).toHaveTextContent(/signing in/i);
  });
});
