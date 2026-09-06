import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { writeAuditEvent } from "../audit.ts";
import { assertTwoPersonApproval } from "../domain.ts";
import { AppError } from "../errors.ts";
import { nowIso, sha256Hex, uuid } from "../ids.ts";
import { authMiddleware, requirePerm, type AppVars } from "../middleware.ts";
import { generateSimplePdf } from "../pdf.ts";

const holdSchema = z.object({
  scopeType: z.string().min(1),
  scopeId: z.string().min(1),
  reason: z.string().min(1),
});

const releaseSchema = z.object({
  reason: z.string().optional(),
});

export function retentionRoutes() {
  const app = new Hono<{ Variables: AppVars }>();
  app.use("/retention-rules/*", authMiddleware);
  app.use("/legal-holds/*", authMiddleware);
  app.use("/disposals/*", authMiddleware);

  app.get("/retention-rules", requirePerm("retention:manage"), async (c) => {
    const deps = c.get("deps");
    const items = await deps.db.all("SELECT * FROM retention_rules ORDER BY record_type, version DESC");
    return c.json({ items, total: items.length });
  });

  app.get("/legal-holds", requirePerm("legalhold:manage"), async (c) => {
    const deps = c.get("deps");
    const items = await deps.db.all(
      "SELECT h.*, u.name AS started_by_name FROM legal_holds h LEFT JOIN users u ON u.id = h.started_by ORDER BY h.started_at DESC",
    );
    return c.json({ items, total: items.length });
  });

  app.post("/legal-holds", requirePerm("legalhold:manage"), zValidator("json", holdSchema), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const body = c.req.valid("json");
    const id = uuid();
    await deps.db.run(
      "INSERT INTO legal_holds (id, scope_type, scope_id, reason, started_by, started_at, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
      id,
      body.scopeType,
      body.scopeId,
      body.reason,
      user.id,
      nowIso(),
    );
    await writeAuditEvent(deps.db, { actorId: user.id, action: "legalhold.start", resourceType: "legal_hold", resourceId: id, correlationId: c.get("correlationId") });
    return c.json({ item: { id, status: "active" } }, 201);
  });

  app.post("/legal-holds/:id/release", requirePerm("legalhold:manage"), zValidator("json", releaseSchema), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>("SELECT * FROM legal_holds WHERE id = ?", id);
    if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    if (String(row.status) !== "active") throw new AppError("CONFLICT", "すでに解除されています", 409);
    if (String(row.started_by) === user.id && user.role !== "admin") {
      throw new AppError("SOD", "開始者自身では解除できません（職務分離）", 409);
    }
    const at = nowIso();
    await deps.db.run("UPDATE legal_holds SET status = 'released', released_by = ?, released_at = ? WHERE id = ?", user.id, at, id);
    await writeAuditEvent(deps.db, { actorId: user.id, action: "legalhold.release", resourceType: "legal_hold", resourceId: id, correlationId: c.get("correlationId") });
    return c.json({ item: { id, status: "released" } });
  });

  app.get("/disposals", requirePerm("disposal:manage"), async (c) => {
    const deps = c.get("deps");
    const items = await deps.db.all(
      "SELECT d.*, r.record_type AS rule_name FROM disposal_candidates d LEFT JOIN retention_rules r ON r.record_type = d.record_type ORDER BY d.expires_at",
    );
    return c.json({ items, total: items.length });
  });

  app.post("/disposals/:id/request", requirePerm("disposal:manage"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>("SELECT * FROM disposal_candidates WHERE id = ?", id);
    if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    if (String(row.status) !== "candidate") throw new AppError("CONFLICT", "廃棄申請できない状態です", 409);
    await deps.db.run(
      "UPDATE disposal_candidates SET status = 'pending_approval', requested_by = ?, legal_hold_checked_at = ? WHERE id = ?",
      user.id,
      nowIso(),
      id,
    );
    await writeAuditEvent(deps.db, { actorId: user.id, action: "disposal.request", resourceType: "disposal_candidate", resourceId: id, correlationId: c.get("correlationId") });
    return c.json({ item: { id, status: "pending_approval" } });
  });

  app.post("/disposals/:id/approve", requirePerm("disposal:manage"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>("SELECT * FROM disposal_candidates WHERE id = ?", id);
    if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    if (String(row.status) !== "pending_approval") throw new AppError("CONFLICT", "承認待ちのみ承認できます", 409);
    assertTwoPersonApproval(String(row.requested_by ?? ""), user.id);
    await deps.db.run("UPDATE disposal_candidates SET status = 'approved', approved_by = ? WHERE id = ?", user.id, id);
    await writeAuditEvent(deps.db, { actorId: user.id, action: "disposal.approve", resourceType: "disposal_candidate", resourceId: id, correlationId: c.get("correlationId") });
    return c.json({ item: { id, status: "approved" } });
  });

  app.post("/disposals/:id/execute", requirePerm("disposal:manage"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>("SELECT * FROM disposal_candidates WHERE id = ?", id);
    if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    if (String(row.status) !== "approved") throw new AppError("CONFLICT", "承認済みのみ実行できます", 409);
    const hold = await deps.db.first<Record<string, unknown>>(
      "SELECT * FROM legal_holds WHERE scope_type = ? AND scope_id = ? AND status = 'active'",
      String(row.record_type),
      String(row.record_id),
    );
    if (hold) throw new AppError("CONFLICT", "法的保全中のため廃棄できません", 409);
    const certificateHash = await sha256Hex(`${id}:${row.record_type}:${row.record_id}:${nowIso()}`);
    const at = nowIso();
    await deps.db.run(
      "UPDATE disposal_candidates SET status = 'disposed', executed_by = ?, executed_at = ?, certificate_hash = ? WHERE id = ?",
      user.id,
      at,
      certificateHash,
      id,
    );
    await writeAuditEvent(deps.db, { actorId: user.id, action: "disposal.execute", resourceType: "disposal_candidate", resourceId: id, correlationId: c.get("correlationId") });
    return c.json({ item: { id, status: "disposed", certificateHash } });
  });

  app.get("/disposals/:id/certificate.pdf", requirePerm("disposal:manage"), async (c) => {
    const deps = c.get("deps");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>(
      "SELECT d.*, req.name AS requested_by_name, appr.name AS approved_by_name, exec.name AS executed_by_name FROM disposal_candidates d " +
        "LEFT JOIN users req ON req.id = d.requested_by LEFT JOIN users appr ON appr.id = d.approved_by LEFT JOIN users exec ON exec.id = d.executed_by " +
        "WHERE d.id = ?",
      id,
    );
    if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    if (String(row.status) !== "disposed" || !row.certificate_hash) {
      throw new AppError("CONFLICT", "廃棄が完了していないため証明書を発行できません", 409);
    }
    const lines = [
      `対象種別: ${row.record_type} / 対象ID: ${row.record_id}`,
      `保持期限: ${row.expires_at}`,
      `申請者: ${row.requested_by_name ?? row.requested_by}`,
      `承認者: ${row.approved_by_name ?? row.approved_by}`,
      `実行者: ${row.executed_by_name ?? row.executed_by}`,
      `実行日時: ${row.executed_at}`,
      `証明書ハッシュ (SHA-256): ${row.certificate_hash}`,
      "",
      "本証明書は、法的保全が課されていないことを確認の上、二者承認を経て廃棄が実行されたことを示す。",
    ];
    const pdf = generateSimplePdf(`廃棄証明書 / Disposal Certificate ${id}`, lines);
    return new Response(pdf, {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="disposal-certificate-${id}.pdf"` },
    });
  });

  return app;
}
