import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { incomingSchema, type Incoming } from '../../schema.js';
import type { WechatAdapter, SendResult } from '../wechat/contract.js';
export class MockAdapter implements WechatAdapter {
  readonly supportsGeneratedImages=true;
  private connected = false;
  private handlers = new Set<(message: Incoming) => void>();
  readonly sent: { targetId: string; content: string; kind: 'text' | 'image' }[] = [];
  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; }
  onMessage(handler: (message: Incoming) => void) { this.handlers.add(handler); }
  async getStatus() { return { connected: this.connected, backend: 'mock', realWechat: false }; }
  receive(input: unknown) {
    if (!this.connected) throw new Error('mock disconnected');
    const message = incomingSchema.parse(input);
    for (const handler of this.handlers) handler(message);
  }
  async sendText(targetId: string, content: string): Promise<SendResult> {
    if (!this.connected) return { status: 'not-sent', reason: 'disconnected' };
    this.sent.push({ targetId, content, kind: 'text' });
    return { status: 'sent', messageId: `mock:${randomUUID()}` };
  }
  async sendImage(targetId: string, imagePath: string): Promise<SendResult> {
    await access(imagePath);
    if (!this.connected) return { status: 'not-sent', reason: 'disconnected' };
    this.sent.push({ targetId, content: imagePath, kind: 'image' });
    return { status: 'sent', messageId: `mock:${randomUUID()}` };
  }
}
