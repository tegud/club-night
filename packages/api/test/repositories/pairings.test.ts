import { describe, it, expect, beforeEach } from 'vitest';
import type { Pairing } from '@club-night/shared';
import { resetTable } from '../setup/table';
import { putPairing, listPairingsByNight, deletePairingsByNight } from '../../src/repositories/pairings';

beforeEach(async () => {
  await resetTable();
});

function pairing(overrides: Partial<Pairing> = {}): Pairing {
  return {
    pairingId: 'p1',
    nightId: 'night-1',
    clubId: 'club-1',
    systemKey: 'WARHAMMER_40K',
    players: [
      { signupId: 's1', playerName: 'Ada' },
      { signupId: 's2', playerName: 'Bob' },
    ],
    status: 'MATCHED',
    ...overrides,
  };
}

describe('pairings repository', () => {
  it('stores and lists pairings for a night', async () => {
    await putPairing(pairing({ pairingId: 'p1' }));
    await putPairing(pairing({ pairingId: 'p2', systemKey: 'BLOOD_BOWL' }));
    const list = await listPairingsByNight('night-1');
    expect(list.map((p) => p.pairingId).sort()).toEqual(['p1', 'p2']);
    expect(list.find((p) => p.pairingId === 'p1')!.players).toHaveLength(2);
  });

  it('scopes pairings to their night', async () => {
    await putPairing(pairing({ pairingId: 'p1', nightId: 'night-1' }));
    await putPairing(pairing({ pairingId: 'p2', nightId: 'night-2' }));
    expect(await listPairingsByNight('night-1')).toHaveLength(1);
  });

  it('clears all pairings for a night', async () => {
    await putPairing(pairing({ pairingId: 'p1' }));
    await putPairing(pairing({ pairingId: 'p2', systemKey: 'BLOOD_BOWL' }));
    await deletePairingsByNight('night-1');
    expect(await listPairingsByNight('night-1')).toEqual([]);
  });
});
