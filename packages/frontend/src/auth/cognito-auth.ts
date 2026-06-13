import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { COGNITO_CLIENT_ID, COGNITO_USER_POOL_ID } from '../config';

function pool(): CognitoUserPool {
  return new CognitoUserPool({ UserPoolId: COGNITO_USER_POOL_ID, ClientId: COGNITO_CLIENT_ID });
}

/** Sign in with email + password (SRP); resolves the Cognito ID token. */
export function signIn(email: string, password: string): Promise<string> {
  const user = new CognitoUser({ Username: email, Pool: pool() });
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise<string>((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: (err) => reject(err instanceof Error ? err : new Error('Sign-in failed')),
      newPasswordRequired: () => reject(new Error('A new password is required — set it in the Cognito console first.')),
    });
  });
}

export function signOut(): void {
  pool().getCurrentUser()?.signOut();
}
