import { z } from 'zod';
export const incomingSchema = z.object({
  id: z.string().min(1).max(256),
  conversationId: z.string().min(1).max(256),
  kind: z.enum(['private', 'group']),
  senderId: z.string().min(1).max(256),
  senderName: z.string().min(1).max(128).optional(),
  text: z.string().min(1).max(5000),
  mentionedBot: z.boolean().default(false),
  replyToBot: z.boolean().default(false),
  isSelf: z.boolean().default(false),
  timestamp: z.number().int().positive(),
  source: z.string().min(1).max(100).default('simulator')
});
export type Incoming = z.infer<typeof incomingSchema>;
