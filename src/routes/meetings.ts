import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { writeAuditEvent } from "../audit.ts";
import { transitionMeeting } from "../domain.ts";
import { AppError } from "../errors.ts";
import { nowIso, sha256Hex, uuid } from "../ids.ts";
import { authMiddleware, requirePerm, type AppVars } from "../middleware.ts";
import { notifyUser } from "../services/notify.ts";
import { generateSimplePdf } from "../pdf.ts";
import type { Db } from "../db/types.ts";

const meetingSchema = z.object({
  bodyId: z.string().min(1),
  title: z.string().min(1),
  heldAt: z.string().min(1),
  method: z.string().default("in_person"),
  chairUserId: z.string().optional(),
});

const convocationSchema = z.object({
  dueAt: z.string().min(1),
  note: z.string().optional(),
});

const attendanceSchema = z.object({
  userId: z.string().min(1),
  eventType: z.enum(["attend", "late", "leave", "reenter", "online"]),
  occurredAt: z.string().min(1),
  note: z.string().optional(),
});

const statusSchema = z.object({
  status: z.enum(["prepared", "convened", "in_progress", "closed", "minutes_review", "finalized"]),
});

const minutesSchema = z.object({
  content: z.string().min(1),
  reason: z.string().optional(),
});

export function meetingsRoutes() {
  const app = new Hono<{ Variables: AppVars }>();
  app.use("/meetings/*", authMiddleware);
  app.use("/minutes/*", authMiddleware);

  app.get("/meetings", requirePerm("meeting:view"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const rows = await deps.db.all<Record<string, unknown>>(
      `SELECT m.*, b.name AS body_name FROM meetings m JOIN bodies b ON b.id = m.body_id ORDER BY m.held_at DESC`,
    );
    const items = rows.filter((r) => canSeeBody(user, String(r.body_id)));
    return c.json({ items, total: items.length });
  });

  app.post("/meetings", requirePerm("meeting:manage"), zValidator("json", meetingSchema), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const body = c.req.valid("json");
    const bodyRow = await deps.db.first<Record<string, unknown>>("SELECT * FROM bodies WHERE id = ?", body.bodyId);
    if (!bodyRow) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    const rule = await deps.db.first<Record<string, unknown>>(
      "SELECT * FROM governance_rules WHERE body_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1",
      body.bodyId,
    );
    const id = uuid();
    const at = nowIso();
    await deps.db.run(
      `INSERT INTO meetings (id, body_id, title, held_at, status, method, chair_user_id, rule_version_id, created_by, created_at)
       VALUES (?, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?)`,
      id,
      body.bodyId,
      body.title,
      body.heldAt,
      body.method,
      body.chairUserId ?? null,
      rule ? String(rule.id) : null,
      user.id,
      at,
    );
    await writeAuditEvent(deps.db, { actorId: user.id, action: "meeting.create", resourceType: "meeting", resourceId: id, correlationId: c.get("correlationId") });
    const row = await deps.db.first<Record<string, unknown>>(
      "SELECT m.*, b.name AS body_name FROM meetings m JOIN bodies b ON b.id = m.body_id WHERE m.id = ?",
      id,
    );
    return c.json({ item: row }, 201);
  });

  app.get("/meetings/:id", requirePerm("meeting:view"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>(
      "SELECT m.*, b.name AS body_name FROM meetings m JOIN bodies b ON b.id = m.body_id WHERE m.id = ?",
      id,
    );
    if (!row || !canSeeBody(user, String(row.body_id))) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    const [convocations, attendanceEvents, agendaItems, minutes] = await Promise.all([
      deps.db.all("SELECT * FROM convocations WHERE meeting_id = ? ORDER BY issued_at", id),
      deps.db.all("SELECT ae.*, u.name AS user_name FROM attendance_events ae JOIN users u ON u.id = ae.user_id WHERE ae.meeting_id = ? ORDER BY occurred_at", id),
      deps.db.all("SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY urgent DESC, created_at", id),
      deps.db.first<Record<string, unknown>>("SELECT * FROM minutes WHERE meeting_id = ?", id),
    ]);
    let minutesDetail: Record<string, unknown> | null = null;
    if (minutes) {
      const versions = await deps.db.all("SELECT * FROM minutes_versions WHERE minutes_id = ? ORDER BY version_no DESC", String(minutes.id));
      const signatories = await deps.db.all(
        `SELECT ms.*, mv.version_no, u.name AS user_name FROM minutes_signatories ms
         JOIN minutes_versions mv ON mv.id = ms.version_id JOIN users u ON u.id = ms.user_id
         WHERE mv.minutes_id = ? ORDER BY ms.signed_at`,
        String(minutes.id),
      );
      minutesDetail = { ...minutes, versions, signatories };
    }
    return c.json({ item: { ...row, convocations, attendanceEvents, agendaItems, minutes: minutesDetail } });
  });

  app.post("/meetings/:id/convocations", requirePerm("convocation:create"), zValidator("json", convocationSchema), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const meetingId = c.req.param("id")!;
    const body = c.req.valid("json");
    const meeting = await deps.db.first<Record<string, unknown>>("SELECT * FROM meetings WHERE id = ?", meetingId);
    if (!meeting) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    const id = uuid();
    const at = nowIso();
    const recipients = await deps.db.all<Record<string, unknown>>("SELECT * FROM users WHERE active = 1");
    const members = recipients.filter((r) => (JSON.parse(String(r.body_ids)) as string[]).includes(String(meeting.body_id)));
    const ops = [
      {
        sql: `INSERT INTO convocations (id, meeting_id, issued_at, due_at, issued_by, status, note) VALUES (?, ?, ?, ?, ?, 'issued', ?)`,
        params: [id, meetingId, at, body.dueAt, user.id, body.note ?? null],
      },
      ...members.map((m) => ({
        sql: `INSERT INTO delivery_receipts (id, convocation_id, user_id, channel, status) VALUES (?, ?, ?, 'app', 'pending')`,
        params: [uuid(), id, String(m.id)],
      })),
    ];
    await deps.db.batch(ops);
    await writeAuditEvent(deps.db, { actorId: user.id, action: "convocation.create", resourceType: "meeting", resourceId: meetingId, correlationId: c.get("correlationId") });
    for (const m of members) {
      await notifyUser(deps.db, String(m.id), "招集通知", `会議「${String(meeting.title)}」の招集が発出されました`, "convocation", "meeting", meetingId);
    }
    return c.json({ item: { id, meetingId, issuedAt: at, dueAt: body.dueAt, status: "issued" } }, 201);
  });

  app.post("/meetings/:id/attendance-events", requirePerm("attendance:create"), zValidator("json", attendanceSchema), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const meetingId = c.req.param("id")!;
    const body = c.req.valid("json");
    const meeting = await deps.db.first<Record<string, unknown>>("SELECT * FROM meetings WHERE id = ?", meetingId);
    if (!meeting) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    const target = await deps.db.first<Record<string, unknown>>("SELECT * FROM users WHERE id = ? AND active = 1", body.userId);
    if (!target) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    const id = uuid();
    const at = nowIso();
    await deps.db.run(
      `INSERT INTO attendance_events (id, meeting_id, user_id, event_type, occurred_at, note, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      meetingId,
      body.userId,
      body.eventType,
      body.occurredAt,
      body.note ?? null,
      user.id,
      at,
    );
    await writeAuditEvent(deps.db, { actorId: user.id, action: "attendance.create", resourceType: "meeting", resourceId: meetingId, resourceVersion: body.eventType, correlationId: c.get("correlationId") });
    return c.json({ item: { id, meetingId, userId: body.userId, eventType: body.eventType, occurredAt: body.occurredAt } }, 201);
  });

  app.post("/meetings/:id/status", requirePerm("meeting:status"), zValidator("json", statusSchema), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const meetingId = c.req.param("id")!;
    const { status } = c.req.valid("json");
    const meeting = await deps.db.first<Record<string, unknown>>("SELECT * FROM meetings WHERE id = ?", meetingId);
    if (!meeting) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    transitionMeeting(String(meeting.status), status);
    await deps.db.run("UPDATE meetings SET status = ? WHERE id = ?", status, meetingId);
    await writeAuditEvent(deps.db, { actorId: user.id, action: "meeting.status", resourceType: "meeting", resourceId: meetingId, resourceVersion: status, correlationId: c.get("correlationId") });
    return c.json({ item: { id: meetingId, status } });
  });

  app.post("/meetings/:id/minutes/versions", requirePerm("minutes:create"), zValidator("json", minutesSchema), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const meetingId = c.req.param("id")!;
    const body = c.req.valid("json");
    const meeting = await deps.db.first<Record<string, unknown>>("SELECT * FROM meetings WHERE id = ?", meetingId);
    if (!meeting) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    const minutes = await deps.db.first<Record<string, unknown>>("SELECT * FROM minutes WHERE meeting_id = ?", meetingId);
    const at = nowIso();
    const minutesId = minutes ? String(minutes.id) : uuid();
    const versionId = uuid();
    const versionNo = minutes ? Number(await nextVersionNo(deps, minutesId)) : 1;
    const sha = await sha256Hex(body.content);
    const ops: Array<{ sql: string; params: Array<string | number | null> }> = [];
    if (!minutes) {
      ops.push({ sql: "INSERT INTO minutes (id, meeting_id, status, created_by, created_at) VALUES (?, ?, 'drafting', ?, ?)", params: [minutesId, meetingId, user.id, at] });
    }
    ops.push({
      sql: "INSERT INTO minutes_versions (id, minutes_id, version_no, content, reason, created_by, created_at, sha256_full, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')",
      params: [versionId, minutesId, versionNo, body.content, body.reason ?? null, user.id, at, sha],
    });
    if (minutes) {
      const prevVersionId = String(minutes.current_version_id ?? "");
      if (prevVersionId) {
        ops.push({
          sql: "UPDATE minutes_signatories SET invalidated_at = ?, invalidated_by = ? WHERE version_id = ? AND invalidated_at IS NULL",
          params: [at, user.id, prevVersionId],
        });
      }
      ops.push({ sql: "UPDATE minutes SET current_version_id = ?, status = 'drafting' WHERE id = ?", params: [versionId, minutesId] });
    } else {
      ops.push({ sql: "UPDATE minutes SET current_version_id = ? WHERE id = ?", params: [versionId, minutesId] });
    }
    await deps.db.batch(ops);
    await writeAuditEvent(deps.db, { actorId: user.id, action: "minutes.version", resourceType: "minutes", resourceId: minutesId, resourceVersion: String(versionNo), correlationId: c.get("correlationId") });
    const signers = await deps.db.all<Record<string, unknown>>("SELECT * FROM users WHERE active = 1");
    const bodyMembers = signers.filter((r) => (JSON.parse(String(r.body_ids)) as string[]).includes(String(meeting.body_id)));
    for (const s of bodyMembers) {
      if (String(s.id) !== user.id) {
        await notifyUser(deps.db, String(s.id), "議事録の確認依頼", `会議「${String(meeting.title)}」の議事録 v${versionNo} が作成されました`, "minutes", "meeting", meetingId);
      }
    }
    return c.json({ item: { id: versionId, minutesId, versionNo, status: "draft", sha256Full: sha } }, 201);
  });

  app.post("/minutes/:versionId/signoffs", requirePerm("minutes:sign"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const versionId = c.req.param("versionId")!;
    const version = await deps.db.first<Record<string, unknown>>(
      "SELECT mv.*, m.meeting_id, mt.body_id FROM minutes_versions mv JOIN minutes m ON m.id = mv.minutes_id JOIN meetings mt ON mt.id = m.meeting_id WHERE mv.id = ?",
      versionId,
    );
    if (!version) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    const bodyMembers = JSON.parse(String((await deps.db.first<Record<string, unknown>>("SELECT * FROM users WHERE id = ?", user.id))?.body_ids ?? "[]")) as string[];
    if (!bodyMembers.includes(String(version.body_id))) {
      throw new AppError("FORBIDDEN", "記名資格がありません", 403);
    }
    const existing = await deps.db.first<Record<string, unknown>>(
      "SELECT * FROM minutes_signatories WHERE version_id = ? AND user_id = ?",
      versionId,
      user.id,
    );
    if (existing) {
      throw new AppError("CONFLICT", "この版にはすでに記名済みです", 409);
    }
    const at = nowIso();
    await deps.db.run(
      "INSERT INTO minutes_signatories (id, version_id, user_id, signed_at, verification_result) VALUES (?, ?, ?, ?, 'ok')",
      uuid(),
      versionId,
      user.id,
      at,
    );
    await writeAuditEvent(deps.db, { actorId: user.id, action: "minutes.sign", resourceType: "minutes_version", resourceId: versionId, resourceVersion: String(version.version_no), correlationId: c.get("correlationId") });
    return c.json({ item: { versionId, userId: user.id, signedAt: at } }, 201);
  });

  app.get("/minutes/:versionId/pdf", requirePerm("evidence:view"), async (c) => {
    const deps = c.get("deps");
    const versionId = c.req.param("versionId")!;
    const version = await deps.db.first<Record<string, unknown>>(
      "SELECT mv.*, mt.title AS meeting_title FROM minutes_versions mv JOIN minutes m ON m.id = mv.minutes_id JOIN meetings mt ON mt.id = m.meeting_id WHERE mv.id = ?",
      versionId,
    );
    if (!version) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    const signatories = await deps.db.all<Record<string, unknown>>(
      "SELECT ms.signed_at, u.name FROM minutes_signatories ms JOIN users u ON u.id = ms.user_id WHERE ms.version_id = ? AND ms.invalidated_at IS NULL ORDER BY ms.signed_at",
      versionId,
    );
    const lines = [
      `会議: ${version.meeting_title}`,
      `版: v${version.version_no} / SHA-256: ${version.sha256_full}`,
      `作成日時: ${version.created_at}`,
      "",
      "-- 議事録本文 --",
      ...String(version.content).split("\n"),
      "",
      "-- 記名 --",
      ...(signatories.length ? signatories.map((s) => `${s.name}: ${s.signed_at}`) : ["（記名なし）"]),
    ];
    const pdf = generateSimplePdf(`議事録 v${version.version_no}`, lines);
    return new Response(pdf, {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="minutes-${versionId}.pdf"` },
    });
  });

  return app;
}

function canSeeBody(user: { role: string; bodyIds: string[] }, bodyId: string): boolean {
  const globalRoles = ["secretariat", "admin", "legal", "records", "kansa_yaku", "internal_audit_manager", "internal_auditor", "audit_log_viewer"];
  return globalRoles.includes(user.role) || user.bodyIds.includes(bodyId);
}

async function nextVersionNo(deps: { db: Db }, minutesId: string): Promise<number> {
  const row = await deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM minutes_versions WHERE minutes_id = ?", minutesId);
  return (row?.cnt ?? 0) + 1;
}
