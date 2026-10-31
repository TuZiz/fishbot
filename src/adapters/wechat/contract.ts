import type { Incoming } from '../../schema.js';
export type WechatMessage = Incoming;
export interface SendResult { status: 'sent' | 'not-sent' | 'unknown'; messageId?: string; reason?: string }
export interface AdapterStatus { connected: boolean; backend: string; realWechat: boolean }
export interface WechatAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: (message: WechatMessage) => void): void;
  sendText(targetId: string, content: string): Promise<SendResult>;
  sendImage(targetId: string, imagePath: string): Promise<SendResult>;
  getStatus(): Promise<AdapterStatus>;
}
