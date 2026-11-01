import { z } from 'zod';
export const incomingSchema = z.object({
  id: z.string().min(1).max(256),
  conversationId: z.string().min(1).max(256),
  kind: z.enum(['private', 'group']),
  senderId: z.string().min(1).max(256),
  senderName: z.string().min(1).max(128).optional(),
  text: z.string().min(1).max(5000),
  image:z.object({md5:z.string().regex(/^[a-f0-9]{32}$/)}).optional(),
  quote:z.object({messageId:z.string().regex(/^[1-9]\d{0,23}$/),senderId:z.string().min(1).max(256),type:z.number().int(),image:z.object({md5:z.string().regex(/^[a-f0-9]{32}$/)}).optional()}).optional(),
  mentionedBot: z.boolean().default(false),
  replyToBot: z.boolean().default(false),
  isSelf: z.boolean().default(false),
  timestamp: z.number().int().positive(),
  source: z.string().min(1).max(100).default('simulator')
});
export type Incoming = z.infer<typeof incomingSchema>;
