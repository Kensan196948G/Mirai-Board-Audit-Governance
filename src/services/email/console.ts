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
    // 宛先・件名は機密情報になり得るためログへは出力しない（診断に必要な情報のみ記録）
    console.info(`[email:console] providerId=${providerId} bodyLength=${message.body.length}`);
    return { ok: true, providerId };
  }
}
