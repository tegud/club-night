import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { COGNITO_CLIENT_ID, COGNITO_USER_POOL_ID } from '../config';

function pool(): CognitoUserPool {
  return new CognitoUserPool({ UserPoolId: COGNITO_USER_POOL_ID, ClientId: COGNITO_CLIENT_ID });
}

/**
 * Result of a sign-in attempt. `NONE` means we have an ID token. `NEW_PASSWORD_REQUIRED`
 * means the account is in FORCE_CHANGE_PASSWORD (admin-created with a temporary password):
 * call `completeNewPassword` with a chosen password to finish and get the ID token.
 */
export type SignInResult =
  | { challenge: 'NONE'; idToken: string }
  | { challenge: 'NEW_PASSWORD_REQUIRED'; completeNewPassword: (newPassword: string) => Promise<string> };

/** Sign in with email + password (SRP); resolves an ID token or a new-password challenge. */
export function signIn(email: string, password: string): Promise<SignInResult> {
  const user = new CognitoUser({ Username: email, Pool: pool() });
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise<SignInResult>((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve({ challenge: 'NONE', idToken: session.getIdToken().getJwtToken() }),
      onFailure: (err) => reject(err instanceof Error ? err : new Error('Sign-in failed')),
      newPasswordRequired: (userAttributes) => {
        // Cognito rejects these read-only attributes if they're echoed back on the challenge.
        delete userAttributes.email_verified;
        delete userAttributes.phone_number_verified;
        resolve({
          challenge: 'NEW_PASSWORD_REQUIRED',
          completeNewPassword: (newPassword) =>
            new Promise<string>((res, rej) => {
              user.completeNewPasswordChallenge(
                newPassword,
                {},
                {
                  onSuccess: (session) => res(session.getIdToken().getJwtToken()),
                  onFailure: (err) => rej(err instanceof Error ? err : new Error('Could not set new password')),
                },
              );
            }),
        });
      },
    });
  });
}

export function signOut(): void {
  pool().getCurrentUser()?.signOut();
}
