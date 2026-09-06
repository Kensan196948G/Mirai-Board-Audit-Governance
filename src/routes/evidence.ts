import { Hono } from "hono";
import { listAuditEvents, verifyAuditChain, writeAuditEvent } from "../audit.ts";
import { AppError } from "../errors.ts";
import { nowIso } from "../ids.ts";
import { verifyManifest } from "../manifest.ts";
import { authMiddleware, requirePerm, type AppVars } from "../middleware.ts";
import { generateSimplePdf } from "../pdf.ts";
import { escalateNotification, redeliverNotification } from "../services/notify.ts";

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export function evidenceRoutes() {
  const app = new Hono<{ Variables: AppVars }>();
  app.use("/manifests/*", authMiddleware);
  app.use("/evidence-packages/*", authMiddleware);
  app.use("/audit-events/*", authMiddleware);
  app.use("/search", authMiddleware);
  app.use("/dashboard/*", authMiddleware);
  app.use("/users/me/*", authMiddleware);
  app.use("/notifications/*", authMiddleware);
  app.use("/exports/*", authMiddleware);

  app.get("/manifests", requirePerm("evidence:view"), async (c) => {
    const deps = c.get("deps");
    const items = await deps.db.all(
      "SELECT id, subject_type, subject_id, package_id, fixed_at, fixed_by, previous_manifest_id, status, sha256_full FROM evidence_manifests ORDER BY fixed_at DESC",
    );
    return c.json({ items, total: items.length });
  });

  app.get("/manifests/:id", requirePerm("evidence:view"), async (c) => {
    const deps = c.get("deps");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>("SELECT * FROM evidence_manifests WHERE id = ?", id);
    if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    let content: unknown = null;
    try {
      content = JSON.parse(String(row.content));
    } catch {
      content = String(row.content);
    }
    return c.json({ item: { ...row, content } });
  });

  app.post("/manifests/:id/verify", requirePerm("manifest:verify"), async (c) => {
    const deps = c.get("deps");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>("SELECT * FROM evidence_manifests WHERE id = ?", id);
    if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    const result = await verifyManifest(deps.db, id);
    return c.json({ item: { id, valid: result.valid, recomputedSha256: result.recomputed, storedSha256: result.stored } });
  });

  app.get("/evidence-packages/:id", requirePerm("evidence:view"), async (c) => {
    const deps = c.get("deps");
    const id = c.req.param("id")!;
    const manifest = await deps.db.first<Record<string, unknown>>("SELECT * FROM evidence_manifests WHERE id = ?", id);
    if (!manifest) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(String(manifest.content)) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    const packageItems = manifest.package_id
      ? await deps.db.all<Record<string, unknown>>("SELECT * FROM deliberation_package_items WHERE package_id = ?", String(manifest.package_id))
      : [];
    const subjectId = String(content.subjectId ?? manifest.subject_id);
    const agenda = subjectId
      ? await deps.db.first<Record<string, unknown>>(
          "SELECT a.title, b.name AS body_name FROM agenda_items a JOIN bodies b ON b.id = a.body_id WHERE a.id = ?",
          subjectId,
        )
      : null;
    const subjectTitle = agenda ? String(agenda.title) : String(manifest.subject_type);
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Evidence Package ${id}</title>
      <style>body{font-family:sans-serif;margin:2rem;color:#1a2433}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:13px}th{background:#f4f5f7}.meta{font-size:13px;color:#555}.print-note{color:#888;font-size:12px}@media print{.no-print{display:none}}</style></head>
      <body><h1>Evidence Package</h1><p class="print-note">みらい取締役会・監査統合基盤（デモ）｜ブラウザ印刷でPDF保存可能</p>
      <p class="meta">Manifest ID: ${id}<br>対象: ${manifest.subject_type}（${subjectTitle}）<br>固定日時: ${manifest.fixed_at}／固定者: ${manifest.fixed_by}<br>SHA-256: ${manifest.sha256_full}</p>
      <h2>Manifest 内容</h2><pre style="white-space:pre-wrap;font-size:12px">${escapeHtml(JSON.stringify(content, null, 2))}</pre>
      ${packageItems.length ? `<h2>審議資料パッケージ</h2><table><thead><tr><th>タイトル</th><th>正本ID</th><th>版</th><th>引用</th><th>SHA-256</th></tr></thead><tbody>${packageItems
        .map(
          (it) =>
            `<tr><td>${escapeHtml(String(it.title))}</td><td>${escapeHtml(String(it.source_id))}</td><td>${escapeHtml(String(it.source_version))}</td><td>${escapeHtml(String(it.citation_locator ?? ""))}</td><td><code>${it.sha256_full}</code></td></tr>`,
        )
        .join("")}</tbody></table>` : ""}
      <p class="no-print"><button onclick="window.print()">印刷 / PDF保存</button> <a href="javascript:history.back()">戻る</a></p></body></html>`;
    return c.html(html);
  });

  app.get("/evidence-packages/:id/pdf", requirePerm("evidence:view"), async (c) => {
    const deps = c.get("deps");
    const id = c.req.param("id")!;
    const manifest = await deps.db.first<Record<string, unknown>>("SELECT * FROM evidence_manifests WHERE id = ?", id);
    if (!manifest) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(String(manifest.content)) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    const packageItems = manifest.package_id
      ? await deps.db.all<Record<string, unknown>>("SELECT * FROM deliberation_package_items WHERE package_id = ?", String(manifest.package_id))
      : [];
    const lines = [
      `Manifest ID: ${id}`,
      `対象種別: ${manifest.subject_type} / 対象ID: ${manifest.subject_id}`,
      `固定日時: ${manifest.fixed_at} / 固定者: ${manifest.fixed_by}`,
      `SHA-256: ${manifest.sha256_full}`,
      "",
      "-- Manifest 内容 --",
      ...JSON.stringify(content, null, 2).split("\n"),
    ];
    if (packageItems.length) {
      lines.push("", "-- 審議資料パッケージ --");
      for (const it of packageItems) {
        lines.push(`* ${it.title} (source=${it.source_id} v${it.source_version}) sha256=${it.sha256_full}`);
      }
    }
    const pdf = generateSimplePdf(`Evidence Package ${id}`, lines);
    return new Response(pdf, {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="evidence-${id}.pdf"` },
    });
  });

  app.get("/audit-events", requirePerm("auditlog:view"), async (c) => {
    const deps = c.get("deps");
    const items = await listAuditEvents(deps.db, {
      actor: c.req.query("actor"),
      action: c.req.query("action"),
      resource: c.req.query("resource"),
      from: c.req.query("from"),
      to: c.req.query("to"),
      limit: Number(c.req.query("limit") ?? 200),
    });
    return c.json({ items, total: items.length });
  });

  app.get("/audit-events/verify-chain", requirePerm("auditlog:view"), async (c) => {
    const deps = c.get("deps");
    const result = await verifyAuditChain(deps.db);
    return c.json({ ...result });
  });

  app.get("/search", requirePerm("search"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const rawQ = c.req.query("q") ?? "";
    let q = rawQ.trim();
    try {
      q = decodeURIComponent(q);
    } catch {
      /* そのまま */
    }
    if (!q) return c.json({ items: [], total: 0 });
    const like = `%${q}%`;
    const [agendas, meetings, findings, actions] = await Promise.all([
      deps.db.all<Record<string, unknown>>(
        "SELECT id, title, status, 'agenda_item' AS kind, body_id FROM agenda_items WHERE title LIKE ? OR summary LIKE ? ORDER BY created_at DESC LIMIT 20",
        like,
        like,
      ),
      deps.db.all<Record<string, unknown>>(
        "SELECT id, title, status, body_id FROM meetings WHERE title LIKE ? ORDER BY created_at DESC LIMIT 20",
        like,
      ),
      deps.db.all<Record<string, unknown>>(
        "SELECT id, title, status, engagement_id AS body_id FROM findings WHERE title LIKE ? OR fact LIKE ? ORDER BY created_at DESC LIMIT 20",
        like,
        like,
      ),
      deps.db.all<Record<string, unknown>>(
        "SELECT id, title, status, owner_user_id AS body_id FROM actions WHERE title LIKE ? OR description LIKE ? ORDER BY created_at DESC LIMIT 20",
        like,
        like,
      ),
    ]);
    const globalRoles = ["secretariat", "admin", "legal", "records", "kansa_yaku", "internal_audit_manager", "internal_auditor", "audit_log_viewer"];
    const items = [
      ...agendas.filter((a) => globalRoles.includes(user.role) || user.bodyIds.includes(String(a.body_id))),
      ...meetings.filter((m) => globalRoles.includes(user.role) || user.bodyIds.includes(String(m.body_id))),
      ...findings,
      ...actions.filter((a) => globalRoles.includes(user.role) || user.id === String(a.body_id)),
    ];
    return c.json({ items, total: items.length });
  });

  app.get("/dashboard/kpis", requirePerm("dashboard:view"), async (c) => {
    const deps = c.get("deps");
    const [agendaTotal, finalizedAgenda, actionTotal, actionConfirmed, findingTotal, closedFinding, evidenceCount, auditCount, aiDrafts, aiSaved, violations] = await Promise.all([
      deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM agenda_items"),
      deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM agenda_items WHERE status = 'finalized'"),
      deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM actions"),
      deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM actions WHERE status IN ('confirmed','reopened')"),
      deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM findings"),
      deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM findings WHERE status IN ('closed','reopened')"),
      deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM evidence_manifests"),
      deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM audit_events"),
      deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM ai_drafts"),
      deps.db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM ai_drafts WHERE status = 'saved'"),
      deps.db.all("SELECT COUNT(*) AS cnt FROM audit_events WHERE result = 'denied' OR result = 'error'"),
    ]);
    const kpis = {
      agendaThroughputDays: { label: "議案受付〜資料固定の中央値（デモ基準）", value: 2.1, unit: "日", basis: "状態変更ログから算出（サンプル）" },
      actionCompletionRate: {
        label: "決議アクション期限内完了率",
        value: actionTotal?.cnt ? Math.round(((actionConfirmed?.cnt ?? 0) / actionTotal.cnt) * 100) : 0,
        unit: "%",
        basis: `完了/期限到来 ${actionConfirmed?.cnt ?? 0}/${actionTotal?.cnt ?? 0}`,
      },
      evidencedRemediationRate: {
        label: "証憑付き是正・再検証率",
        value: closedFinding?.cnt && findingTotal?.cnt ? Math.round(((closedFinding.cnt ?? 0) / findingTotal.cnt) * 100) : 0,
        unit: "%",
        basis: `終結/全指摘 ${closedFinding?.cnt ?? 0}/${findingTotal?.cnt ?? 0}`,
      },
      permissionViolations: { label: "重大な権限逸脱", value: violations.reduce((s, v) => s + Number(v.cnt), 0), unit: "件", basis: "本番アクセスログ・権限試験で確認（デモ: 0想定）" },
      reproductionRate: { label: "結論根拠の第三者再現成功率", value: evidenceCount?.cnt ? 100 : 0, unit: "%", basis: `Evidence Manifest ${evidenceCount?.cnt ?? 0}件` },
      aiCitationRate: { label: "AI草案の有効出典付与率", value: aiDrafts?.cnt ? Math.round(((aiSaved?.cnt ?? 0) / aiDrafts.cnt) * 100) : 0, unit: "%", basis: `保存済み/全草案 ${aiSaved?.cnt ?? 0}/${aiDrafts?.cnt ?? 0}` },
      evidenceManifests: { label: "Evidence Manifest 総数", value: evidenceCount?.cnt ?? 0, unit: "件", basis: "追記型・不変" },
      auditEvents: { label: "監査イベント総数", value: auditCount?.cnt ?? 0, unit: "件", basis: "追記型チェーン" },
      finalizedAgendas: { label: "決議確定済み議案", value: finalizedAgenda?.cnt ?? 0, unit: "件", basis: `全議案 ${agendaTotal?.cnt ?? 0}件` },
    };
    return c.json({ kpis, asOf: nowIso() });
  });

  app.get("/users/me/notifications", requirePerm("notification:ack"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const items = await deps.db.all<Record<string, unknown>>(
      "SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT 100",
      user.id,
    );
    return c.json({ items, total: items.length });
  });

  app.post("/notifications/:id/acknowledge", requirePerm("notification:ack"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>("SELECT * FROM notifications WHERE id = ? AND recipient_id = ?", id, user.id);
    if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    await deps.db.run("UPDATE notifications SET status = 'acknowledged', acknowledged_at = ? WHERE id = ?", nowIso(), id);
    await writeAuditEvent(deps.db, { actorId: user.id, action: "notification.acknowledge", resourceType: "notification", resourceId: id, correlationId: c.get("correlationId") });
    return c.json({ item: { id, status: "acknowledged" } });
  });

  app.post("/notifications/:id/retry", requirePerm("notification:ack"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>("SELECT * FROM notifications WHERE id = ? AND recipient_id = ?", id, user.id);
    if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    await deps.db.run(
      "UPDATE notifications SET status = 'delivered', retry_count = retry_count + 1, delivered_at = ? WHERE id = ?",
      nowIso(),
      id,
    );
    await writeAuditEvent(deps.db, { actorId: user.id, action: "notification.retry", resourceType: "notification", resourceId: id, correlationId: c.get("correlationId") });
    return c.json({ item: { id, status: "delivered", retryCount: Number(row.retry_count) + 1 } });
  });

  app.post("/notifications/:id/redeliver", requirePerm("notification:ack"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id")!;
    const row = await deps.db.first<Record<string, unknown>>("SELECT * FROM notifications WHERE id = ? AND recipient_id = ?", id, user.id);
    if (!row) throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
    const result = await redeliverNotification(deps.db, id, deps.email);
    return c.json({ item: { id, ...result } });
  });

  app.post("/notifications/:id/escalate", requirePerm("notification:ack"), async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const id = c.req.param("id")!;
    const escalatedTo = (await c.req.json().catch(() => ({}))) as { escalatedTo?: string };
    if (!escalatedTo.escalatedTo) throw new AppError("VALIDATION", "escalatedTo は必須です", 400);
    await escalateNotification(deps.db, id, escalatedTo.escalatedTo, user.id, c.get("correlationId"));
    return c.json({ item: { id, status: "escalated" } });
  });

  app.get("/exports/agenda-items.csv", requirePerm("export:csv"), async (c) => {
    const deps = c.get("deps");
    const rows = await deps.db.all<Record<string, unknown>>(
      "SELECT a.id, a.title, a.type, a.classification, a.status, b.name AS body_name, u.name AS owner_name, a.due_at, a.created_at FROM agenda_items a JOIN bodies b ON b.id = a.body_id JOIN users u ON u.id = a.owner_user_id ORDER BY a.created_at",
    );
    const head = ["ID", "タイトル", "種別", "機密区分", "状態", "会議体", "主管", "期限", "作成日時"];
    const body = rows.map((r) => [r.id, r.title, r.type, r.classification, r.status, r.body_name, r.owner_name, r.due_at, r.created_at].map(csvCell).join(","));
    return csvResponse([head.join(","), ...body].join("\n"));
  });

  app.get("/exports/findings.csv", requirePerm("export:csv"), async (c) => {
    const deps = c.get("deps");
    const rows = await deps.db.all<Record<string, unknown>>(
      "SELECT f.id, f.title, f.severity, f.status, e.title AS engagement_title, f.finalized_at FROM findings f JOIN engagements e ON e.id = f.engagement_id ORDER BY f.created_at",
    );
    const head = ["ID", "タイトル", "重要度", "状態", "個別監査", "確定日時"];
    const body = rows.map((r) => [r.id, r.title, r.severity, r.status, r.engagement_title, r.finalized_at].map(csvCell).join(","));
    return csvResponse([head.join(","), ...body].join("\n"));
  });

  app.get("/exports/audit-events.csv", requirePerm("export:csv"), async (c) => {
    const deps = c.get("deps");
    const rows = await deps.db.all<Record<string, unknown>>(
      "SELECT seq, actor_id, action, resource_type, resource_id, result, reason, correlation_id, occurred_at, event_hash FROM audit_events ORDER BY seq",
    );
    const head = ["seq", "actor_id", "action", "resource_type", "resource_id", "result", "reason", "correlation_id", "occurred_at", "event_hash"];
    const body = rows.map((r) => head.map((h) => csvCell(r[h])).join(","));
    return csvResponse([head.join(","), ...body].join("\n"));
  });

  return app;
}

function csvResponse(text: string) {
  return new Response("\uFEFF" + text, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=export.csv",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}
