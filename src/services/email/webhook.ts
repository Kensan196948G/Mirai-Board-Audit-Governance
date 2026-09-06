import { hmacSignHex } from "../signing.ts";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./types.ts";

/**
 * 実メールプロバイダ（SendGrid/SES等）へのWebhook中継スタブ。
 * `EMAIL_WEBHOOK_URL` / `EMAIL_WEBHOOK_SECRET` が設定されて初めて動作する（既定では未設定＝不使用）。
 * バックログ B-03 の本接続はこのクラスへ実プロバイダのURL・署名鍵を設定するだけで完結する設計。
 */
export class WebhookEmailProvider implements EmailProvider {
  readonly name = "webhook";
  private readonly url: string;
  private readonly secret: string;

  constructor(url: string, secret: string) {
    this.url = url;
    this.secret = secret;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const payload = JSON.stringify({ ...message, sentAt: new Date().toISOString() });
    const signature = await hmacSignHex(this.secret, payload);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mbag-signature": signature },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        return { ok: false, error: `webhook responded ${res.status}` };
      }
      const providerId = res.headers.get("x-provider-message-id") ?? undefined;
      return { ok: true, providerId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "webhook request failed" };
    }
  }
}
