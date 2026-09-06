import { uuid } from "../../ids.ts";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./types.ts";

/**
 * 既定のメールプロバイダ（デモ用）。外部へは一切送信せず、送信内容をログへ記録するのみ。
 * バックログ B-03「実メール通知」の本実装までの安全な既定動作。
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const providerId = `console:${uuid()}`;
    console.info(`[email:console] to=${message.to} subject=${message.subject} providerId=${providerId}`);
    return { ok: true, providerId };
  }
}
