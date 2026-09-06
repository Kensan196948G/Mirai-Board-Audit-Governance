import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { writeAuditEvent } from "../audit.ts";
import {
  certifyAccess,
  grantEmergencyAccess,
  listCertificationStatus,
  listEmergencyGrants,
  revokeEmergencyGrant,
  sweepAccessControl,
} from "../services/access-control.ts";
import { authMiddleware, requirePerm, type AppVars } from "../middleware.ts";

const FR_MAP = [
  ["FR-01", "議案の作成・提出・差戻し・取下げ・再上程", "agenda_items / POST /api/agenda-items / submit / return / withdraw / resubmit", "implemented", "tests/integration/api.test.ts（議案・決議・Evidence Manifest）"],
  ["FR-02", "招集・出欠イベント", "convocations / attendance-events", "implemented", "scripts/e2e-smoke.mjs（E2Eスモーク）"],
  ["FR-03", "利益相反の申告・判定・操作別制御", "conflicts / determinations / eligibility", "implemented", "tests/integration/api.test.ts（COI忌避の議決拒否）"],
  ["FR-04", "審議資料パッケージと結論Evidence Manifest", "deliberation-packages / evidence_manifests", "implemented", "tests/integration/api.test.ts（決議確定・Manifest検証）"],
  ["FR-05", "正式議決と定足数", "votes / decisions / eligibility_snapshots", "implemented", "tests/unit/domain.test.ts（定足数）＋ tests/integration/api.test.ts（定足数不足422）"],
  ["FR-06", "議事録版・二重記名拒否・再記名", "minutes versions / signoffs", "implemented", "tests/integration/api.test.ts（二重記名409）"],
  ["FR-07", "決議から履行タスク", "decisions/:id/actions / action_events", "implemented", "tests/integration/api.test.ts（独立確認者のみ完了）"],
  ["FR-08", "監査ユニバース・リスク評価・年度計画・個別監査", "audit-universes / risk-assessments / annual-plans / engagements", "implemented", "scripts/e2e-smoke.mjs（E2Eスモーク）"],
  ["FR-09", "手続・調書・レビュー（作成者≠レビュー者）", "procedures / workpapers / reviews", "implemented", "tests/integration/api.test.ts（監査・職務分離）"],
  ["FR-10", "指摘・経営回答・残余リスク・是正・再検証・再オープン", "findings / management-responses / risk-acceptances / remediations / retests", "implemented", "tests/integration/api.test.ts（指摘確定・再検証・再オープン）"],
  ["FR-11", "通知・受領・再通知", "notifications / acknowledge / retry", "implemented", "tests/integration/api.test.ts（監査ログチェーン・検索・通知）"],
  ["FR-12", "検索・ダッシュボード・CSV・証拠パッケージ", "search / dashboard / exports / evidence-packages", "implemented", "tests/integration/api.test.ts＋ scripts/e2e-smoke.mjs（CSV/検索/KPI）"],
  ["FR-13", "保持・法的保全・廃棄制御", "retention-rules / legal-holds / disposals", "implemented", "tests/integration/api.test.ts（保持・法的保全）"],
  ["FR-14", "役割・職務分離競合", "permissions / admin/sod-conflicts", "implemented", "tests/integration/api.test.ts（認証・RBAC）"],
  ["FR-15", "AI草案（出典必須・人レビュー）", "ai/drafts（規則ベースデモ）", "implemented", "tests/integration/api.test.ts（AI草案ガード）"],
];

const AC_MAP = [
  ["AC-01", "代表シナリオの開始〜終端", "implemented", "scripts/e2e-smoke.mjs（E2Eスモーク）"],
  ["AC-02", "認可・存在非露出・水平権限", "implemented", "tests/integration/api.test.ts（認証・RBAC）"],
  ["AC-03", "Manifest固定・再現", "implemented", "tests/integration/api.test.ts（決議確定・Manifest検証）"],
  ["AC-04", "復旧・連携断（PoC予定）", "backlog", "B-08"],
  ["AC-05", "AI出典・保存禁止", "implemented", "tests/integration/api.test.ts（AI草案ガード）"],
  ["AC-06", "監査ログ・エクスポート記録", "implemented", "tests/integration/api.test.ts（監査ログチェーン）"],
  ["AC-07", "職務分離・二重記名", "implemented", "tests/integration/api.test.ts（監査・職務分離／二重記名409）"],
  ["AC-08", "法的保全〜廃棄", "implemented", "tests/integration/api.test.ts（保持・法的保全）"],
  ["AC-09", "資格・定足数・集計", "implemented", "tests/unit/domain.test.ts（定足数エンジン）＋ tests/integration/api.test.ts"],
];

const NFR_MAP = [
  ["NFR-01", "可用性・復旧（RTO/RPO）", "partial", "D1 Time Travel手順・スクリプト整備済み（docs/runbooks/backup-restore.md）。本番実施・記録が未了（B-08）"],
  ["NFR-02", "性能（p95 2秒/検索3秒）", "partial", "k6負荷試験スクリプト整備済み（scripts/load/k6-smoke.js）。実施環境での測定が未了（B-06）"],
  ["NFR-03", "セキュリティ試験", "partial", "CI組み込み済み（npm audit / Dependency Review / CodeQL）。CodeQLはGitHub Advanced Security有効化が別途必要（B-07）"],
  ["NFR-04", "アクセシビリティ・レスポンシブ", "implemented", "web/src（セマンティックHTML・キーボード・320px）"],
  ["NFR-05", "監視・ログ・トレース", "partial", "observability有効／アラートはB-08"],
  ["NFR-06", "Manifest再現・署名・欠番検証", "implemented", "verify-chain / manifests/:id/verify"],
];

const certifySchema = z.object({
  userId: z.string().min(1),
  cycle: z.string().min(1),
  days: z.number().int().positive().max(366).optional(),
});

const emergencyGrantSchema = z.object({
  userId: z.string().min(1),
  permission: z.string().min(1),
  reason: z.string().min(1),
  expiresInHours: z.number().int().positive().max(24 * 30),
});

export function adminRoutes() {
  const app = new Hono<{ Variables: AppVars }>();
  app.use("/users", authMiddleware);
  app.use("/admin/*", authMiddleware);
  app.use("/access/*", authMiddleware);

  app.get("/access/certifications", requirePerm("access:view"), async (c) => {
    const items = await listCertificationStatus(c.get("deps").db);
    return c.json({ items, total: items.length });
  });

  app.post("/access/certifications", requirePerm("access:manage"), zValidator("json", certifySchema), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const body = c.req.valid("json");
    const result = await certifyAccess(deps.db, {
      userId: body.userId,
      certifiedBy: user.id,
      cycle: body.cycle,
      days: body.days,
      correlationId: c.get("correlationId"),
    });
    return c.json({ item: result }, 201);
  });

  app.post("/access/sweep", requirePerm("access:manage"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const result = await sweepAccessControl(deps.db, { actorId: user.id, correlationId: c.get("correlationId") });
    return c.json({ item: result });
  });

  app.get("/access/emergency-grants", requirePerm("access:view"), async (c) => {
    const items = await listEmergencyGrants(c.get("deps").db);
    return c.json({ items, total: items.length });
  });

  app.post("/access/emergency-grants", requirePerm("access:manage"), zValidator("json", emergencyGrantSchema), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const body = c.req.valid("json");
    const result = await grantEmergencyAccess(deps.db, {
      userId: body.userId,
      permission: body.permission,
      reason: body.reason,
      grantedBy: user.id,
      expiresInHours: body.expiresInHours,
      correlationId: c.get("correlationId"),
    });
    return c.json({ item: result }, 201);
  });

  app.post("/access/emergency-grants/:id/revoke", requirePerm("access:manage"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id")!;
    await revokeEmergencyGrant(deps.db, id, user.id, c.get("correlationId"));
    return c.json({ item: { id, status: "revoked" } });
  });

  app.get("/users", requirePerm("agenda:view"), async (c) => {
    const deps = c.get("deps");
    const items = await deps.db.all<Record<string, unknown>>(
      "SELECT id, name, email, role, title, department, outside, body_ids, active FROM users WHERE active = 1 ORDER BY role, name",
    );
    return c.json({ items, total: items.length });
  });

  app.get("/admin/sod-conflicts", requirePerm("admin:sod"), async (c) => {
    const deps = c.get("deps");
    const workpapers = await deps.db.all<Record<string, unknown>>(
      "SELECT w.id, w.title, w.author_id, w.reviewer_id, au.name AS author_name, rv.name AS reviewer_name FROM workpapers w LEFT JOIN users au ON au.id = w.author_id LEFT JOIN users rv ON rv.id = w.reviewer_id",
    );
    const findings = await deps.db.all<Record<string, unknown>>(
      "SELECT f.id, f.title, f.created_by, u.name AS created_by_name FROM findings f LEFT JOIN users u ON u.id = f.created_by",
    );
    const conflicts = [
      ...workpapers.filter((w) => w.reviewer_id && w.author_id === w.reviewer_id).map((w) => ({
        type: "workpaper_self_review",
        resource: String(w.id),
        detail: `調書「${String(w.title)}」の作成者とレビュー者が同一`,
      })),
      ...findings.map((f) => ({
        type: "finding_author_check",
        resource: String(f.id),
        detail: `指摘「${String(f.title)}」作成者: ${String(f.created_by_name)}（確定・再検証時の分離要確認）`,
      })),
    ];
    return c.json({ items: conflicts, total: conflicts.length });
  });

  app.get("/admin/requirements", requirePerm("admin:requirements"), async (c) => {
    return c.json({
      fr: FR_MAP.map(([id, name, api, status, test]) => ({ id, name, api, status, test })),
      ac: AC_MAP.map(([id, name, status, test]) => ({ id, name, status, test })),
      nfr: NFR_MAP.map(([id, name, status, note]) => ({ id, name, status, note })),
      asOf: new Date().toISOString(),
    });
  });

  app.get("/admin/audit-log-access", requirePerm("admin:audit-access"), async (c) => {
    const deps = c.get("deps");
    const users = await deps.db.all<Record<string, unknown>>(
      "SELECT id, name, role, title FROM users WHERE active = 1 AND role IN ('admin','kansa_yaku','internal_audit_manager','records','audit_log_viewer') ORDER BY role",
    );
    return c.json({ items: users, total: users.length });
  });

  app.post("/admin/log-demo-access", requirePerm("admin:audit-access"), async (c) => {
    const user = c.get("user");
    await writeAuditEvent(c.get("deps").db, { actorId: user.id, action: "admin.audit_access.view", resourceType: "admin", resourceId: "audit-log-access", correlationId: c.get("correlationId") });
    return c.json({ ok: true });
  });

  return app;
}
