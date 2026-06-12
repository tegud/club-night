import { z } from 'zod';
import { GAME_SYSTEM_KEYS } from './game-systems';
import { NIGHT_STATUSES } from './domain';

export const signupInputSchema = z.object({
  playerName: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().email({ message: 'A valid email is required' }),
  systemKey: z.enum(GAME_SYSTEM_KEYS),
  note: z.string().trim().max(500).optional(),
});

export type SignupInput = z.infer<typeof signupInputSchema>;

export const offeredSystemSchema = z.object({
  systemKey: z.enum(GAME_SYSTEM_KEYS),
  prominent: z.boolean(),
});

export const createNightSchema = z.object({
  title: z.string().trim().min(1).max(200),
  eventDate: z.string().datetime(),
  signupDeadline: z.string().datetime(),
  offeredSystems: z.array(offeredSystemSchema).min(1),
});
export type CreateNightInput = z.infer<typeof createNightSchema>;

export const updateNightSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  eventDate: z.string().datetime().optional(),
  signupDeadline: z.string().datetime().optional(),
  offeredSystems: z.array(offeredSystemSchema).min(1).optional(),
  status: z.enum(NIGHT_STATUSES).optional(),
});
export type UpdateNightInput = z.infer<typeof updateNightSchema>;

export const updateSignupSchema = z.object({
  systemKey: z.enum(GAME_SYSTEM_KEYS).optional(),
  note: z.string().trim().max(500).optional(),
});
export type UpdateSignupInput = z.infer<typeof updateSignupSchema>;
