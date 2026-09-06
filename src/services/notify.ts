import type { Db } from "../db/types.ts";
import { nowIso, uuid } from "../ids.ts";
import { writeAuditEvent } from "../audit.ts";
import { AppError } from "../errors.ts";
import { getEmailProvider, type EmailConfig } from "./email/index.ts";

export async function notifyUser(
  db: Db,
  recipientId: string,
  title: string,
  body: string,
  kind: string,
  refType?: string,
  refId?: string,
  email?: EmailConfig,
): Promise<string> {
  const at = nowIso();
  const id = uuid();
  await db.run(
    "INSERT INTO notifications (id, recipient_id, title, body, kind, ref_type, ref_id, status, created_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?)",
    id,
    recipientId,
    title,
    body,
    kind,
    refType ?? null,
    refId ?? null,
    at,
    at,
  );
  await recordDelivery(db, id, recipientId, title, body, email ?? {});
  return id;
}

/** 通知配送を記録し、設定済みのメールプロバイダで送信を試みる（失敗時はDLQ記録・例外を投げない） */
async function recordDelivery(
  db: Db,
  notificationId: string,
  recipientId: string,
  title: string,
  body: string,
  email: EmailConfig,
): Promise<void> {
  const provider = getEmailProvider(email);
  const deliveryId = uuid();
  const at = nowIso();
  const recipient = await db.first<Record<string, unknown>>("SELECT email FROM users WHERE id = ?", recipientId);
  let status = "sent";
  let lastError: string | null = null;
  try {
    const result = await provider.send({ to: String(recipient?.email ?? ""), subject: title, body });
    if (!result.ok) {
      status = "dead_letter";
      lastError = result.error ?? "unknown error";
    }
  } catch (err) {
    status = "dead_letter";
    lastError = err instanceof Error ? err.message : "unknown error";
  }
  await db.run(
    "INSERT INTO notification_deliveries (id, notification_id, channel, provider, status, attempt, last_error, created_at, updated_at) VALUES (?, ?, 'email', ?, ?, 1, ?, ?, ?)",
    deliveryId,
    notificationId,
    provider.name,
    status,
    lastError,
    at,
    at,
  );
}

export async function redeliverNotification(
  db: Db,
  notificationId: string,
  email?: EmailConfig,
): Promise<{ status: string; attempt: number }> {
  const notification = await db.first<Record<string, unknown>>("SELECT * FROM notifications WHERE id = ?", notificationId);
  if (!notification) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
  const last = await db.first<Record<string, unknown>>(
    "SELECT * FROM notification_deliveries WHERE notification_id = ? ORDER BY created_at DESC LIMIT 1",
    notificationId,
  );
  const attempt = (last ? Number(last.attempt) : 0) + 1;
  const provider = getEmailProvider(email ?? {});
  const recipient = await db.first<Record<string, unknown>>("SELECT email FROM users WHERE id = ?", String(notification.recipient_id));
  const deliveryId = uuid();
  const at = nowIso();
  let status = "sent";
  let lastError: string | null = null;
  try {
    const result = await provider.send({ to: String(recipient?.email ?? ""), subject: String(notification.title), body: String(notification.body) });
    if (!result.ok) {
      status = "dead_letter";
      lastError = result.error ?? "unknown error";
    }
  } catch (err) {
    status = "dead_letter";
    lastError = err instanceof Error ? err.message : "unknown error";
  }
  await db.run(
    "INSERT INTO notification_deliveries (id, notification_id, channel, provider, status, attempt, last_error, created_at, updated_at) VALUES (?, ?, 'email', ?, ?, ?, ?, ?, ?)",
    deliveryId,
    notificationId,
    provider.name,
    status,
    attempt,
    lastError,
    at,
    at,
  );
  return { status, attempt };
}

/** 未受領通知のエスカレーション（バックログ B-11: 通知の高度化） */
export async function escalateNotification(
  db: Db,
  notificationId: string,
  escalatedTo: string,
  actorId: string,
  correlationId?: string,
): Promise<void> {
  const notification = await db.first<Record<string, unknown>>("SELECT * FROM notifications WHERE id = ?", notificationId);
  if (!notification) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
  if (String(notification.status) === "acknowledged") {
    throw new AppError("CONFLICT", "既に受領済みの通知はエスカレーションできません", 409);
  }
  const target = await db.first<Record<string, unknown>>("SELECT id FROM users WHERE id = ?", escalatedTo);
  if (!target) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
  const at = nowIso();
  await db.run("UPDATE notifications SET escalated_at = ?, escalated_to = ? WHERE id = ?", at, escalatedTo, notificationId);
  await notifyUser(
    db,
    escalatedTo,
    `【エスカレーション】${String(notification.title)}`,
    `未受領のため転送されました。原受信者: ${String(notification.recipient_id)}\n${String(notification.body)}`,
    "escalation",
    String(notification.ref_type ?? ""),
    String(notification.ref_id ?? ""),
  );
  await writeAuditEvent(db, {
    actorId,
    action: "notification.escalate",
    resourceType: "notification",
    resourceId: notificationId,
    reason: `to:${escalatedTo}`,
    correlationId,
  });
}
