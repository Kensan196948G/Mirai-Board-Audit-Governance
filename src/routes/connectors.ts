import { Hono } from "hono";
import { writeAuditEvent } from "../audit.ts";
import { DocumentManagementConnector } from "../services/connectors/document-management.ts";
import { verifyHmacSignatureHex } from "../services/signing.ts";
import { AppError } from "../errors.ts";
import { nowIso, sha256Hex, uuid, SYSTEM_ACTOR_ID } from "../ids.ts";
import { authMiddleware, requirePerm, type AppVars } from "../middleware.ts";

/** バックログ B-04: 正本外部連携（受信Webhookの署名検証・記録、設定状況の一覧） */
export function connectorRoutes() {
  const app = new Hono<{ Variables: AppVars }>();
  app.use("/admin/external-connectors", authMiddleware);

  app.get("/admin/external-connectors", requirePerm("connector:manage"), async (c) => {
    const deps = c.get("deps");
    const documentManagement = new DocumentManagementConnector(deps.documentManagementWebhookUrl, deps.documentManagementWebhookSecret);
    const recent = await deps.db.all<Record<string, unknown>>(
      "SELECT connector, direction, status, created_at FROM external_connector_events ORDER BY created_at DESC LIMIT 20",
    );
    return c.json({
      items: [{ name: documentManagement.name, configured: documentManagement.configured }],
      recentEvents: recent,
    });
  });

  // 実連携先からのWebhook受信（HMAC-SHA256署名検証。未設定・不正署名は拒否のみで記録)
  app.post("/connectors/:name/inbound", async (c) => {
    const deps = c.get("deps");
    const name = c.req.param("name")!;
    const raw = await c.req.text();
    const signature = c.req.header("x-mbag-signature") ?? "";
    const secret = deps.connectorWebhookSecret;
    const payloadSha256 = await sha256Hex(raw);
    const at = nowIso();
    if (!secret) {
      await deps.db.run(
        "INSERT INTO external_connector_events (id, connector, direction, status, payload_sha256, detail, created_at) VALUES (?, ?, 'inbound', 'rejected', ?, 'not configured', ?)",
        uuid(),
        name,
        payloadSha256,
        at,
      );
      throw new AppError("FORBIDDEN", "この連携は未設定です", 403);
    }
    const valid = await verifyHmacSignatureHex(secret, raw, signature);
    await deps.db.run(
      "INSERT INTO external_connector_events (id, connector, direction, status, payload_sha256, detail, created_at) VALUES (?, ?, 'inbound', ?, ?, ?, ?)",
      uuid(),
      name,
      valid ? "accepted" : "rejected",
      payloadSha256,
      valid ? null : "invalid signature",
      at,
    );
    if (!valid) throw new AppError("FORBIDDEN", "署名検証に失敗しました", 403);
    await writeAuditEvent(deps.db, {
      actorId: SYSTEM_ACTOR_ID,
      action: "connector.inbound",
      resourceType: "external_connector_event",
      resourceId: name,
      correlationId: c.get("correlationId"),
    });
    return c.json({ ok: true });
  });

  return app;
}
