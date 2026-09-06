import type { Db } from "../db/types.ts";
import { nowIso, uuid, SYSTEM_ACTOR_ID } from "../ids.ts";
import { writeAuditEvent } from "../audit.ts";
import { AppError } from "../errors.ts";

/** バックログ B-09: 四半期アクセス再認証・緊急権限の自動失効 */

export const ACCESS_RECERT_DAYS = 90;

export function addDaysIso(fromIso: string, days: number): string {
  const d = new Date(fromIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export async function certifyAccess(
  db: Db,
  input: { userId: string; certifiedBy: string; cycle: string; correlationId?: string; days?: number },
): Promise<{ id: string; expiresAt: string }> {
  const target = await db.first<Record<string, unknown>>("SELECT id FROM users WHERE id = ?", input.userId);
  if (!target) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
  const id = uuid();
  const certifiedAt = nowIso();
  const expiresAt = addDaysIso(certifiedAt, input.days ?? ACCESS_RECERT_DAYS);
  await db.run(
    "INSERT INTO access_certifications (id, user_id, cycle, certified_by, certified_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
    id,
    input.userId,
    input.cycle,
    input.certifiedBy,
    certifiedAt,
    expiresAt,
  );
  await writeAuditEvent(db, {
    actorId: input.certifiedBy,
    action: "access.certify",
    resourceType: "user",
    resourceId: input.userId,
    reason: input.cycle,
    correlationId: input.correlationId,
  });
  return { id, expiresAt };
}

export async function listCertificationStatus(db: Db): Promise<Array<Record<string, unknown>>> {
  return db.all(
    `SELECT u.id AS user_id, u.name, u.role, u.active,
       (SELECT c.expires_at FROM access_certifications c WHERE c.user_id = u.id ORDER BY c.certified_at DESC LIMIT 1) AS latest_expires_at,
       (SELECT c.status FROM access_certifications c WHERE c.user_id = u.id ORDER BY c.certified_at DESC LIMIT 1) AS latest_status
     FROM users u WHERE u.active = 1 ORDER BY u.role, u.name`,
  );
}

/**
 * 期限切れの再認証を強制失効させ、対象ユーザーを非活性化する（システム実行または管理者手動実行）。
 * 失効・非活性化はいずれも「対象がまだ期待した状態のときだけ」を条件にした単一UPDATEで行い、
 * スイープと同時に新しい再認証が登録された場合でもユーザーを誤って非活性化しない。
 */
export async function sweepExpiredCertifications(
  db: Db,
  opts: { actorId?: string; correlationId?: string } = {},
): Promise<{ expiredCertifications: number; deactivatedUsers: string[] }> {
  const now = nowIso();
  const candidates = await db.all<Record<string, unknown>>(
    `SELECT DISTINCT user_id FROM access_certifications WHERE status = 'active' AND expires_at < ?`,
    now,
  );
  const deactivated: string[] = [];
  let expiredCount = 0;
  for (const row of candidates) {
    const userId = String(row.user_id);
    // このユーザーの最新の認定が、依然として期限切れ・未処理のものである場合のみ失効させる
    // （スイープ実行中に新しい認定が登録された場合はここで changes=0 になり安全に打ち切られる）
    const expireResult = await db.run(
      `UPDATE access_certifications SET status = 'expired'
       WHERE status = 'active' AND expires_at < ? AND user_id = ?
         AND certified_at = (SELECT MAX(c2.certified_at) FROM access_certifications c2 WHERE c2.user_id = ?)`,
      now,
      userId,
      userId,
    );
    if (expireResult.changes < 1) continue;
    expiredCount += 1;
    const deactivateResult = await db.run("UPDATE users SET active = 0 WHERE id = ? AND active = 1", userId);
    if (deactivateResult.changes >= 1) {
      deactivated.push(userId);
      await writeAuditEvent(db, {
        actorId: opts.actorId ?? SYSTEM_ACTOR_ID,
        action: "access.recert_expired_deactivate",
        resourceType: "user",
        resourceId: userId,
        result: "ok",
        reason: "quarterly recertification overdue",
        correlationId: opts.correlationId,
      });
    }
  }
  return { expiredCertifications: expiredCount, deactivatedUsers: deactivated };
}

export async function grantEmergencyAccess(
  db: Db,
  input: { userId: string; permission: string; reason: string; grantedBy: string; expiresInHours: number; correlationId?: string },
): Promise<{ id: string; expiresAt: string }> {
  const target = await db.first<Record<string, unknown>>("SELECT id FROM users WHERE id = ?", input.userId);
  if (!target) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
  const id = uuid();
  const grantedAt = nowIso();
  const expiresAt = new Date(Date.parse(grantedAt) + input.expiresInHours * 3_600_000).toISOString();
  await db.run(
    "INSERT INTO emergency_access_grants (id, user_id, permission, reason, granted_by, granted_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
    id,
    input.userId,
    input.permission,
    input.reason,
    input.grantedBy,
    grantedAt,
    expiresAt,
  );
  await writeAuditEvent(db, {
    actorId: input.grantedBy,
    action: "access.emergency_grant",
    resourceType: "user",
    resourceId: input.userId,
    reason: `${input.permission}: ${input.reason}`,
    correlationId: input.correlationId,
  });
  return { id, expiresAt };
}

export async function revokeEmergencyGrant(
  db: Db,
  id: string,
  revokedBy: string,
  correlationId?: string,
): Promise<void> {
  const row = await db.first<Record<string, unknown>>("SELECT * FROM emergency_access_grants WHERE id = ?", id);
  if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
  // status='active' を条件にした単一UPDATEで判定し、失効スイープや並行取消しとの競合による
  // 二重処理（'revoked' が 'expired' 等で上書きされる／二重の監査イベント）を防ぐ
  const result = await db.run(
    "UPDATE emergency_access_grants SET status = 'revoked', revoked_by = ?, revoked_at = ? WHERE id = ? AND status = 'active'",
    revokedBy,
    nowIso(),
    id,
  );
  if (result.changes < 1) throw new AppError("CONFLICT", "既に失効しています", 409);
  await writeAuditEvent(db, {
    actorId: revokedBy,
    action: "access.emergency_revoke",
    resourceType: "user",
    resourceId: String(row.user_id),
    correlationId,
  });
}

export async function listEmergencyGrants(db: Db): Promise<Array<Record<string, unknown>>> {
  return db.all(
    `SELECT g.*, u.name AS user_name, gb.name AS granted_by_name FROM emergency_access_grants g
     LEFT JOIN users u ON u.id = g.user_id LEFT JOIN users gb ON gb.id = g.granted_by
     ORDER BY g.granted_at DESC`,
  );
}

/** 有効な緊急権限が付与されているか（役割ベース権限に対する追加判定として利用可能） */
export async function hasActiveEmergencyGrant(db: Db, userId: string, permission: string): Promise<boolean> {
  const row = await db.first<Record<string, unknown>>(
    "SELECT id FROM emergency_access_grants WHERE user_id = ? AND permission = ? AND status = 'active' AND expires_at > ?",
    userId,
    permission,
    nowIso(),
  );
  return Boolean(row);
}

/** 期限切れの緊急権限を自動失効させる（システム実行または管理者手動実行） */
export async function sweepExpiredEmergencyGrants(
  db: Db,
  opts: { actorId?: string; correlationId?: string } = {},
): Promise<{ expiredGrants: number }> {
  const now = nowIso();
  const candidates = await db.all<Record<string, unknown>>(
    "SELECT id, user_id, permission FROM emergency_access_grants WHERE status = 'active' AND expires_at < ?",
    now,
  );
  let expiredCount = 0;
  for (const row of candidates) {
    // status='active' を条件にした単一UPDATEで判定し、手動取消しとの競合時は
    // 監査イベントを二重生成しない（changes=0 なら何もしない）
    const result = await db.run(
      "UPDATE emergency_access_grants SET status = 'expired' WHERE id = ? AND status = 'active'",
      String(row.id),
    );
    if (result.changes < 1) continue;
    expiredCount += 1;
    await writeAuditEvent(db, {
      actorId: opts.actorId ?? SYSTEM_ACTOR_ID,
      action: "access.emergency_expired",
      resourceType: "user",
      resourceId: String(row.user_id),
      reason: String(row.permission),
      correlationId: opts.correlationId,
    });
  }
  return { expiredGrants: expiredCount };
}

/** cron/管理操作からまとめて実行するための集約スイープ */
export async function sweepAccessControl(
  db: Db,
  opts: { actorId?: string; correlationId?: string } = {},
): Promise<{ expiredCertifications: number; deactivatedUsers: string[]; expiredGrants: number }> {
  const certs = await sweepExpiredCertifications(db, opts);
  const grants = await sweepExpiredEmergencyGrants(db, opts);
  return { ...certs, expiredGrants: grants.expiredGrants };
}
