export const clubPk = (clubId: string): string => `CLUB#${clubId}`;
export const clubMetaSk = (): string => '#META';
export const clubSlugGsi1Pk = (slug: string): string => `CLUBSLUG#${slug}`;

export const nightSk = (nightId: string): string => `NIGHT#${nightId}`;
export const nightSkPrefix = (): string => 'NIGHT#';

export const signupPk = (nightId: string): string => `NIGHT#${nightId}`;
export const signupSk = (signupId: string): string => `SIGNUP#${signupId}`;
export const signupSkPrefix = (): string => 'SIGNUP#';
export const signupEmailGsi3Pk = (nightId: string, emailLower: string): string =>
  `NIGHT#${nightId}#EMAIL#${emailLower}`;

export const userGsi2Pk = (userId: string): string => `USER#${userId}`;

export const authCodePk = (clubId: string, emailLower: string): string =>
  `AUTHCODE#${clubId}#${emailLower}`;
export const authCodeSk = (): string => '#AUTHCODE';

export const membershipSk = (userId: string): string => `MEMBER#${userId}`;
