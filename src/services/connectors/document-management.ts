import { hmacSignHex } from "../signing.ts";
import type { ConnectorSyncEvent, ConnectorSyncResult, ExternalConnector } from "./types.ts";

/**
 * 正本の文書管理システムへの連携コネクタ（スタブ）。
 * `DOCUMENT_MANAGEMENT_WEBHOOK_URL` と `DOCUMENT_MANAGEMENT_WEBHOOK_SECRET` の両方が
 * 揃うまでは `configured=false` で、呼び出しても no-op（実害なし）。
 * 送信ペイロードは `x-mbag-signature`（HMAC-SHA256）で署名する。
 */
export class DocumentManagementConnector implements ExternalConnector {
  readonly name = "document-management";
  readonly configured: boolean;
  private readonly webhookUrl?: string;
  private readonly webhookSecret?: string;

  constructor(webhookUrl?: string, webhookSecret?: string) {
    this.webhookUrl = webhookUrl;
    this.webhookSecret = webhookSecret;
    this.configured = Boolean(webhookUrl && webhookSecret);
  }

  async syncOutbound(event: ConnectorSyncEvent): Promise<ConnectorSyncResult> {
    if (!this.configured || !this.webhookUrl || !this.webhookSecret) {
      return { ok: false, error: "not configured" };
    }
    const payload = JSON.stringify(event);
    const signature = await hmacSignHex(this.webhookSecret, payload);
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mbag-signature": signature },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? { ok: true } : { ok: false, error: `responded ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "request failed" };
    }
  }
}
