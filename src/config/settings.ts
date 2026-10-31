import { z } from 'zod';
import type { Store } from '../storage/store.js';
export const scopeSchema = z.tuple([z.enum(['private','group']),z.string().min(1).max(256)]);
export const settingsSchema = z.object({
  privateEnabled: z.boolean().default(true), groupEnabled: z.boolean().default(true),
  whitelist: z.array(scopeSchema).max(500).default([]), paused: z.boolean().default(false),
  persona: z.string().min(10).max(12000).default('你是大肥鱼，一个大家知晓的 AI 聊天伙伴。有点懒、贪吃、嘴硬、傲娇，喜欢吐槽和接梗，幽默但不过度卖萌。偶尔犯傻，不重复固定口头禅。遇到认真问题就认真回答；不知道就直说，不编造事实。默认一两句自然微信口语，复杂问题可以展开。不攻击弱者，不挑拨关系，不泄露别人的信息。不假装真人。'),
  model: z.string().min(1).max(100).default('deepseek-flash'), temperature:z.number().min(0).max(2).default(0.9),
  maxTokens:z.number().int().min(128).max(8192).default(1000), mergeMs:z.number().int().min(10).max(10000).default(1200),
  topicTtlMs:z.number().int().min(100).max(300000).default(60000),
  groups:z.record(z.string(),z.object({enabled:z.boolean().default(true),activity:z.number().min(0).max(1).default(0.4),cooldownMs:z.number().int().min(0).max(3600000).default(45000),maxPerMinute:z.number().int().min(1).max(10).default(2)})).default({}),
  memoryEnabled:z.boolean().default(true), retentionDays:z.number().int().min(1).max(365).default(30),
  expressionsEnabled:z.boolean().default(true), expressionCooldownMs:z.number().int().min(1000).max(3600000).default(180000),
});
export type Settings=z.infer<typeof settingsSchema>;
export class SettingsRepository {
  constructor(private store:Store, initial:unknown={}) {
    store.db.exec('CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL)');
    if(!store.db.prepare('SELECT id FROM settings WHERE id=1').get())this.save(settingsSchema.parse(initial));
    this.get();
  }
  get():Settings { return settingsSchema.parse(JSON.parse(String(this.store.db.prepare('SELECT body FROM settings WHERE id=1').get()!.body))); }
  save(value:unknown) { const s=settingsSchema.parse(value);this.store.db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(s));return s; }
}
