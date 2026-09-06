import type { ConnectorSyncEvent, ConnectorSyncResult, ExternalConnector } from "./types.ts";

/**
 * 正本の文書管理システムへの連携コネクタ（スタブ）。
 * `DOCUMENT_MANAGEMENT_WEBHOOK_URL` が未設定の間は `configured=false` で、
 * 呼び出しても no-op（実害なし）。実接続時はURL・署名鍵を設定するだけで有効化される。
 */
export class DocumentManagementConnector implements ExternalConnector {
  readonly name = "document-management";
  readonly configured: boolean;
  private readonly webhookUrl?: string;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl;
    this.configured = Boolean(webhookUrl);
  }

  async syncOutbound(event: ConnectorSyncEvent): Promise<ConnectorSyncResult> {
    if (!this.configured || !this.webhookUrl) {
      return { ok: false, error: "not configured" };
    }
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
      return res.ok ? { ok: true } : { ok: false, error: `responded ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "request failed" };
    }
  }
}
