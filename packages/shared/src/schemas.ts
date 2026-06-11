import { z } from 'zod';
import { GAME_SYSTEM_KEYS } from './game-systems';

export const signupInputSchema = z.object({
  playerName: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().email({ message: 'A valid email is required' }),
  systemKey: z.enum(GAME_SYSTEM_KEYS),
  note: z.string().trim().max(500).optional(),
});

export type SignupInput = z.infer<typeof signupInputSchema>;
