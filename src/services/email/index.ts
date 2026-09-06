import { ConsoleEmailProvider } from "./console.ts";
import { WebhookEmailProvider } from "./webhook.ts";
import type { EmailProvider } from "./types.ts";

export type EmailConfig = {
  provider?: string;
  webhookUrl?: string;
  webhookSecret?: string;
};

export * from "./types.ts";

/**
 * `EMAIL_PROVIDER` 環境変数に応じてプロバイダを選択する。
 * 既定（未設定）は `console`（デモ・安全側）。`webhook` は URL・署名鍵が揃わない限り
 * 設定エラーとして `console` にフォールバックする（fail-safe、実送信の事故を防ぐ）。
 */
export function getEmailProvider(config: EmailConfig): EmailProvider {
  const kind = config.provider ?? "console";
  if (kind === "webhook") {
    if (!config.webhookUrl || !config.webhookSecret) {
      console.warn("[email] EMAIL_PROVIDER=webhook ですが URL/秘密鍵が未設定のため console にフォールバックします");
      return new ConsoleEmailProvider();
    }
    return new WebhookEmailProvider(config.webhookUrl, config.webhookSecret);
  }
  return new ConsoleEmailProvider();
}
