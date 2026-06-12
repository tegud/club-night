import { describe, it, expect } from 'vitest';
import {
  clubPk,
  clubMetaSk,
  clubSlugGsi1Pk,
  nightSk,
  nightSkPrefix,
  signupPk,
  signupSk,
  signupSkPrefix,
  signupEmailGsi3Pk,
  userGsi2Pk,
  membershipSk,
  authCodePk,
  authCodeSk,
} from '../../src/db/keys';

describe('key builders', () => {
  it('builds club keys', () => {
    expect(clubPk('c1')).toBe('CLUB#c1');
    expect(clubMetaSk()).toBe('#META');
    expect(clubSlugGsi1Pk('red-dice')).toBe('CLUBSLUG#red-dice');
  });

  it('builds night keys', () => {
    expect(nightSk('n1')).toBe('NIGHT#n1');
    expect(nightSkPrefix()).toBe('NIGHT#');
  });

  it('builds signup keys', () => {
    expect(signupPk('n1')).toBe('NIGHT#n1');
    expect(signupSk('s1')).toBe('SIGNUP#s1');
    expect(signupSkPrefix()).toBe('SIGNUP#');
    expect(signupEmailGsi3Pk('n1', 'ada@example.com')).toBe('NIGHT#n1#EMAIL#ada@example.com');
  });

  it('builds the user GSI2 partition key', () => {
    expect(userGsi2Pk('u1')).toBe('USER#u1');
  });

  it('builds the membership sort key', () => {
    expect(membershipSk('u1')).toBe('MEMBER#u1');
  });

  it('builds auth-code keys', () => {
    expect(authCodePk('club-1', 'ada@example.com')).toBe('AUTHCODE#club-1#ada@example.com');
    expect(authCodeSk()).toBe('#AUTHCODE');
  });
});
