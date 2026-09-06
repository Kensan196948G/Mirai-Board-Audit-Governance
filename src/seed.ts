import { writeAuditEvent } from "./audit.ts";
import type { Db, SqlValue } from "./db/types.ts";
import { nowIso, sha256Hex } from "./ids.ts";
import { sealManifest } from "./manifest.ts";
import { notifyUser } from "./services/notify.ts";

type Row = Record<string, SqlValue>;

async function insert(db: Db, table: string, row: Row): Promise<void> {
  const keys = Object.keys(row);
  const sql = `INSERT OR IGNORE INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
  await db.run(sql, ...keys.map((k) => row[k] ?? null));
}

export async function seedAll(db: Db): Promise<Record<string, number>> {
  const count: Record<string, number> = {};
  const at = nowIso();

  // 冪等性: ユーザーが既に投入済みなら再投入せず、現状カウントのみ返す
  const existingUsers = await db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM users");
  if ((existingUsers?.cnt ?? 0) > 0) {
    const tables = [
      ["users", "users"],
      ["bodies", "bodies"],
      ["meetings", "meetings"],
      ["agendaItems", "agenda_items"],
      ["findings", "findings"],
      ["auditEvents", "audit_events"],
      ["manifests", "evidence_manifests"],
    ] as const;
    for (const [key, table] of tables) {
      const row = await db.first<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM ${table}`);
      count[key] = row?.cnt ?? 0;
    }
    return { alreadySeeded: 1, ...count };
  }

  /* ---- ユーザー ---- */
  const users: Row[] = [
    { id: "user-director-1", name: "佐藤美咲", email: "sato.misaki@example.jp", role: "director", title: "代表取締役社長", department: "取締役会", outside: 0, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-director-2", name: "鈴木一郎", email: "suzuki.ichiro@example.jp", role: "director", title: "社外取締役", department: "取締役会", outside: 1, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-director-3", name: "高橋花子", email: "takahashi.hanako@example.jp", role: "director", title: "取締役", department: "取締役会", outside: 0, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-director-4", name: "伊藤健", email: "ito.ken@example.jp", role: "director", title: "社外取締役", department: "取締役会", outside: 1, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-director-5", name: "岡田直樹", email: "okada.naoki@example.jp", role: "director", title: "社外取締役", department: "取締役会", outside: 1, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-director-6", name: "森本裕子", email: "morimoto.yuko@example.jp", role: "director", title: "社外取締役", department: "取締役会", outside: 1, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-kansa-1", name: "中村健一", email: "nakamura.kenichi@example.jp", role: "kansa_yaku", title: "常勤監査役", department: "監査役会", outside: 0, body_ids: JSON.stringify(["body-board", "body-audit-supervisory"]), active: 1, created_at: at },
    { id: "user-kansa-2", name: "田中理恵", email: "tanaka.rie@example.jp", role: "kansa_yaku", title: "社外監査役", department: "監査役会", outside: 1, body_ids: JSON.stringify(["body-board", "body-audit-supervisory"]), active: 1, created_at: at },
    { id: "user-kansa-3", name: "渡辺大輔", email: "watanabe.daisuke@example.jp", role: "kansa_yaku", title: "社外監査役", department: "監査役会", outside: 1, body_ids: JSON.stringify(["body-board", "body-audit-supervisory"]), active: 1, created_at: at },
    { id: "user-secretariat-1", name: "高橋一樹", email: "takahashi.kazuki@example.jp", role: "secretariat", title: "総務部 会議体事務局", department: "総務部", outside: 0, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-auditor-1", name: "山田拓也", email: "yamada.takuya@example.jp", role: "internal_auditor", title: "内部監査室 担当", department: "内部監査室", outside: 0, body_ids: JSON.stringify(["body-audit-internal"]), active: 1, created_at: at },
    { id: "user-auditor-2", name: "小林美穂", email: "kobayashi.miho@example.jp", role: "internal_auditor", title: "内部監査室 レビュー担当", department: "内部監査室", outside: 0, body_ids: JSON.stringify(["body-audit-internal"]), active: 1, created_at: at },
    { id: "user-audit-manager-1", name: "佐々木誠", email: "sasaki.makoto@example.jp", role: "internal_audit_manager", title: "内部監査室長", department: "内部監査室", outside: 0, body_ids: JSON.stringify(["body-audit-internal"]), active: 1, created_at: at },
    { id: "user-owner-1", name: "田中洋一", email: "tanaka.yoichi@example.jp", role: "business_owner", title: "経営戦略部長", department: "経営戦略部", outside: 0, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-owner-2", name: "木村佳代", email: "kimura.kayo@example.jp", role: "business_owner", title: "経理部長", department: "経理部", outside: 0, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-legal-1", name: "松本修", email: "matsumoto.osamu@example.jp", role: "legal", title: "法務部 部長", department: "法務部", outside: 0, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-records-1", name: "井上智子", email: "inoue.tomoko@example.jp", role: "records", title: "記録管理担当", department: "総務部", outside: 0, body_ids: JSON.stringify(["body-board"]), active: 1, created_at: at },
    { id: "user-admin-1", name: "林知佳", email: "hayashi.chika@example.jp", role: "admin", title: "システム管理者", department: "IT企画部", outside: 0, body_ids: JSON.stringify([]), active: 1, created_at: at },
    { id: "user-auditlog-1", name: "石田誠", email: "ishida.makoto@example.jp", role: "audit_log_viewer", title: "監査ログ閲覧者", department: "内部監査室", outside: 0, body_ids: JSON.stringify([]), active: 1, created_at: at },
    // cron・Webhook受信等、人間が介在しない操作の監査ログ主体（ログイン不可: active=0）
    { id: "system-automation", name: "システム自動処理", email: "system-automation@internal.invalid", role: "admin", title: "サービスアカウント", department: "システム", outside: 0, body_ids: JSON.stringify([]), active: 0, created_at: at },
  ];
  for (const u of users) {
    await insert(db, "users", u);
  }
  count.users = users.length;

  /* ---- 会議体・規程 ---- */
  await insert(db, "bodies", { id: "body-board", name: "取締役会", body_type: "board", member_count: 8, outside_minimum: 2, quorum_formula: "majority", vote_rule: "majority", minutes_signatory_rule: "chair_and_2", status: "active" });
  await insert(db, "bodies", { id: "body-audit-supervisory", name: "監査役会", body_type: "audit_supervisory", member_count: 3, outside_minimum: 2, quorum_formula: "majority", vote_rule: "majority", minutes_signatory_rule: "chair_and_1", status: "active" });
  await insert(db, "bodies", { id: "body-audit-internal", name: "内部監査室", body_type: "internal_audit", member_count: 3, outside_minimum: 0, quorum_formula: "majority", vote_rule: "majority", minutes_signatory_rule: "head_only", status: "active" });
  await insert(db, "governance_rules", { id: "rule-board-v1", body_id: "body-board", version: 1, rule_type: "board_regulations", effective_from: "2026-04-01T00:00:00.000Z", effective_to: null, quorum_formula: "majority", vote_rule: "majority", signatory_rule: "chair_and_2", status: "active" });
  await insert(db, "governance_rules", { id: "rule-audit-supervisory-v1", body_id: "body-audit-supervisory", version: 1, rule_type: "audit_supervisory_regulations", effective_from: "2026-04-01T00:00:00.000Z", effective_to: null, quorum_formula: "majority", vote_rule: "majority", signatory_rule: "chair_and_1", status: "active" });

  /* ---- 会議 ---- */
  await insert(db, "meetings", { id: "mtg-001", body_id: "body-board", title: "2026年8月 取締役会（第12回）", held_at: "2026-08-18T10:00:00.000Z", status: "in_progress", method: "in_person_and_online", chair_user_id: "user-director-1", rule_version_id: "rule-board-v1", notice_at: "2026-08-11T09:00:00.000Z", created_by: "user-secretariat-1", created_at: "2026-08-11T09:00:00.000Z" });
  await insert(db, "meetings", { id: "mtg-002", body_id: "body-board", title: "2026年7月 取締役会（第11回）", held_at: "2026-07-21T10:00:00.000Z", status: "finalized", method: "in_person", chair_user_id: "user-director-1", rule_version_id: "rule-board-v1", notice_at: "2026-07-14T09:00:00.000Z", created_by: "user-secretariat-1", created_at: "2026-07-14T09:00:00.000Z" });
  await insert(db, "meetings", { id: "mtg-003", body_id: "body-audit-supervisory", title: "2026年8月 監査役会", held_at: "2026-08-19T10:00:00.000Z", status: "convened", method: "in_person", chair_user_id: "user-kansa-1", rule_version_id: "rule-audit-supervisory-v1", notice_at: "2026-08-12T09:00:00.000Z", created_by: "user-secretariat-1", created_at: "2026-08-12T09:00:00.000Z" });
  await insert(db, "convocations", { id: "conv-001", meeting_id: "mtg-001", issued_at: "2026-08-11T09:00:00.000Z", due_at: "2026-08-14T17:00:00.000Z", issued_by: "user-secretariat-1", status: "issued", note: "定例取締役会（デモ）" });
  await insert(db, "convocations", { id: "conv-002", meeting_id: "mtg-002", issued_at: "2026-07-14T09:00:00.000Z", due_at: "2026-07-17T17:00:00.000Z", issued_by: "user-secretariat-1", status: "issued", note: null });
  const attendance = [
    ["mtg-001", "user-director-1", "attend", "2026-08-18T10:02:00.000Z"],
    ["mtg-001", "user-director-2", "attend", "2026-08-18T10:00:00.000Z"],
    ["mtg-001", "user-director-3", "attend", "2026-08-18T10:01:00.000Z"],
    ["mtg-001", "user-director-4", "attend", "2026-08-18T10:03:00.000Z"],
    ["mtg-001", "user-director-5", "online", "2026-08-18T10:00:00.000Z"],
    ["mtg-001", "user-director-6", "attend", "2026-08-18T10:02:00.000Z"],
    ["mtg-001", "user-kansa-1", "attend", "2026-08-18T10:00:00.000Z"],
    ["mtg-002", "user-director-1", "attend", "2026-07-21T10:00:00.000Z"],
    ["mtg-002", "user-director-2", "attend", "2026-07-21T10:00:00.000Z"],
    ["mtg-002", "user-director-3", "attend", "2026-07-21T10:00:00.000Z"],
    ["mtg-002", "user-director-4", "attend", "2026-07-21T10:00:00.000Z"],
    ["mtg-002", "user-director-5", "attend", "2026-07-21T10:00:00.000Z"],
    ["mtg-002", "user-director-6", "attend", "2026-07-21T10:00:00.000Z"],
  ] as const;
  for (const [meetingId, userId, eventType, occurredAt] of attendance) {
    await insert(db, "attendance_events", { id: `att-${meetingId}-${userId}`, meeting_id: meetingId, user_id: userId, event_type: eventType, occurred_at: occurredAt, note: null, recorded_by: "user-secretariat-1", created_at: at });
  }

  /* ---- 議案 ---- */
  const agendaBase = [
    { id: "ag-001", meeting_id: "mtg-001", body_id: "body-board", type: "重要案件", classification: "秘", title: "子会社みらいエナジー株式会社 株式譲渡契約の締結", summary: "連結子会社の全株式をソラリス電力株式会社へ譲渡する契約の承認", owner_user_id: "user-owner-1", status: "decision_pending", rule_version_id: "rule-board-v1", due_at: "2026-08-18T17:00:00.000Z", urgent: 1, created_by: "user-owner-1", created_at: "2026-08-05T10:00:00.000Z", updated_at: "2026-08-12T10:00:00.000Z" },
    { id: "ag-002", meeting_id: "mtg-001", body_id: "body-board", type: "経営方針", classification: "秘", title: "中期経営計画2027年度方針の承認", summary: "2027年度〜2029年度の中期経営計画方針を審議する", owner_user_id: "user-owner-1", status: "in_review", rule_version_id: "rule-board-v1", due_at: "2026-08-18T17:00:00.000Z", urgent: 0, created_by: "user-owner-1", created_at: "2026-08-06T10:00:00.000Z", updated_at: "2026-08-12T09:00:00.000Z" },
    { id: "ag-003", meeting_id: null, body_id: "body-board", type: "規程改定", classification: "内部", title: "内部統制報告制度の運用方針改定", summary: "財務報告に係る内部統制の評価手続を改定する", owner_user_id: "user-owner-2", status: "submitted", rule_version_id: "rule-board-v1", due_at: "2026-08-25T17:00:00.000Z", urgent: 0, created_by: "user-owner-2", created_at: "2026-08-08T10:00:00.000Z", updated_at: "2026-08-09T10:00:00.000Z" },
    { id: "ag-004", meeting_id: "mtg-002", body_id: "body-board", type: "資金調達", classification: "秘", title: "連結子会社への債務保証枠設定", summary: "連結子会社の借入に係る債務保証枠（上限100億円）の設定", owner_user_id: "user-owner-2", status: "finalized", rule_version_id: "rule-board-v1", due_at: "2026-07-21T17:00:00.000Z", urgent: 0, created_by: "user-owner-2", created_at: "2026-07-10T10:00:00.000Z", updated_at: "2026-07-21T11:00:00.000Z" },
    { id: "ag-005", meeting_id: "mtg-003", body_id: "body-audit-supervisory", type: "監査計画", classification: "内部", title: "2026年度内部監査計画の同意", summary: "内部監査室の2026年度計画について監査役会の同意を求める", owner_user_id: "user-audit-manager-1", status: "submitted", rule_version_id: "rule-audit-supervisory-v1", due_at: "2026-08-19T17:00:00.000Z", urgent: 0, created_by: "user-audit-manager-1", created_at: "2026-08-10T10:00:00.000Z", updated_at: "2026-08-10T10:00:00.000Z" },
    { id: "ag-006", meeting_id: null, body_id: "body-board", type: "人事", classification: "秘", title: "社外取締役候補者の選任手続開始", summary: "次期株主総会に向けた社外取締役候補者の選定手続を開始する", owner_user_id: "user-owner-1", status: "returned", rule_version_id: "rule-board-v1", due_at: "2026-09-01T17:00:00.000Z", urgent: 0, created_by: "user-owner-1", created_at: "2026-08-11T10:00:00.000Z", updated_at: "2026-08-12T11:00:00.000Z" },
  ] as Row[];
  for (const a of agendaBase) {
    await insert(db, "agenda_items", a);
  }
  await insert(db, "agenda_status_history", { id: "hist-001", agenda_id: "ag-001", from_status: "created", to_status: "submitted", reason: "事務局へ提出", by_user: "user-owner-1", at: "2026-08-05T11:00:00.000Z" });
  await insert(db, "agenda_status_history", { id: "hist-002", agenda_id: "ag-001", from_status: "submitted", to_status: "in_review", reason: "審議資料固定", by_user: "user-secretariat-1", at: "2026-08-11T12:00:00.000Z" });
  await insert(db, "agenda_status_history", { id: "hist-003", agenda_id: "ag-001", from_status: "in_review", to_status: "decision_pending", reason: "議決受付開始", by_user: "user-secretariat-1", at: "2026-08-18T10:05:00.000Z" });
  await insert(db, "agenda_status_history", { id: "hist-004", agenda_id: "ag-006", from_status: "submitted", to_status: "returned", reason: "候補者要件の補足資料を要求", by_user: "user-secretariat-1", at: "2026-08-12T11:00:00.000Z" });

  /* ---- COI ---- */
  await insert(db, "conflict_declarations", { id: "coi-001", agenda_id: "ag-001", user_id: "user-director-3", status: "declared", reason: "譲渡先ソラリス電力株式会社の非常勤顧問を務めているため", classification: "秘", declared_at: "2026-08-12T10:00:00.000Z", declared_by: "user-director-3" });
  await insert(db, "conflict_determinations", { id: "coid-001", conflict_id: "coi-001", determiner_id: "user-secretariat-1", decision: "recused", controls: JSON.stringify({ view: "blocked", deliberate: "blocked", vote: "blocked", notify: "blocked" }), reason: "利益相反申告により全操作を遮断（機密区分「秘」）", rule_version_id: "rule-board-v1", determined_at: "2026-08-12T10:30:00.000Z", valid_until: null });
  await insert(db, "conflict_declarations", { id: "coi-002", agenda_id: "ag-001", user_id: "user-director-2", status: "declared", reason: "取引関係なし（申告のみ）", classification: "秘", declared_at: "2026-08-12T10:05:00.000Z", declared_by: "user-director-2" });
  await insert(db, "conflict_determinations", { id: "coid-002", conflict_id: "coi-002", determiner_id: "user-secretariat-1", decision: "eligible", controls: JSON.stringify({ view: "allowed", deliberate: "allowed", vote: "allowed", notify: "allowed" }), reason: "利益相反なし", rule_version_id: "rule-board-v1", determined_at: "2026-08-12T10:31:00.000Z", valid_until: null });

  /* ---- 審議資料パッケージ ---- */
  const pkg1 = await sha256Hex("株式譲渡契約書ドラフトv3（みらいエナジー・ソラリス電力）");
  const pkg2 = await sha256Hex("デューデリジェンス報告書要約（2026-07-30版）");
  await insert(db, "deliberation_packages", { id: "pkg-001", agenda_id: "ag-001", version: 1, fixed_at: "2026-08-11T12:00:00.000Z", fixed_by: "user-secretariat-1", rule_version_id: "rule-board-v1", status: "fixed", verification_result: "ok", previous_id: null });
  await insert(db, "deliberation_package_items", { id: "pkgitem-001", package_id: "pkg-001", title: "株式譲渡契約書ドラフト", source_type: "doc", source_id: "DOC-CONTRACT-2026-014", source_version: "v3", uri: "https://docs.example.jp/d/contract-2026-014", sha256_full: pkg1, citation_locator: "第4条 表明保証 / 第8条 クロージング", classification: "秘", content_excerpt: "譲渡価額はデューデリジェンス報告書の評価レンジ内（580億〜620億円）。表明保証の範囲は通常のM&A条件。競業避止条項は法務審査で期間修正済み。" });
  await insert(db, "deliberation_package_items", { id: "pkgitem-002", package_id: "pkg-001", title: "デューデリジェンス報告書要約", source_type: "doc", source_id: "DOC-DD-2026-007", source_version: "v1", uri: "https://docs.example.jp/d/dd-2026-007", sha256_full: pkg2, citation_locator: "第2章 財務 / 第5章 法務", classification: "秘", content_excerpt: "財務面の重要な懸念は認められない。従業員承継条件の確定がクロージング前提条件。" });
  await insert(db, "deliberation_packages", { id: "pkg-002", agenda_id: "ag-002", version: 1, fixed_at: "2026-08-12T09:00:00.000Z", fixed_by: "user-secretariat-1", rule_version_id: "rule-board-v1", status: "fixed", verification_result: "ok", previous_id: null });
  await insert(db, "deliberation_package_items", { id: "pkgitem-003", package_id: "pkg-002", title: "中期経営計画方針骨子", source_type: "doc", source_id: "DOC-PLAN-2026-031", source_version: "v2", uri: null, sha256_full: await sha256Hex("中期経営計画方針骨子v2"), citation_locator: "1. 基本方針 / 3. 経営指標", classification: "秘", content_excerpt: "ROE 10%以上、連結売上高 CAGR 5%。成長投資枠は既存事業のキャッシュフローを上限とする。" });
  const pkg3a = await sha256Hex("債務保証枠設定稟議書");
  await insert(db, "deliberation_packages", { id: "pkg-003", agenda_id: "ag-004", version: 1, fixed_at: "2026-07-15T12:00:00.000Z", fixed_by: "user-secretariat-1", rule_version_id: "rule-board-v1", status: "fixed", verification_result: "ok", previous_id: null });
  await insert(db, "deliberation_package_items", { id: "pkgitem-004", package_id: "pkg-003", title: "債務保証枠設定稟議書", source_type: "doc", source_id: "DOC-FIN-2026-008", source_version: "v1", uri: null, sha256_full: pkg3a, citation_locator: "全頁", classification: "秘", content_excerpt: "連結子会社3社の運転資金借入に対し上限100億円の債務保証を設定する。" });

  /* ---- 資格スナップショット・投票・決議（ag-001 は決議可能な状態） ---- */
  await insert(db, "eligibility_snapshots", { id: "elig-001", agenda_id: "ag-001", as_of: "2026-08-18T10:10:00.000Z", rule_version_id: "rule-board-v1", calculation_inputs: JSON.stringify({ formula: "majority", totalMembers: 8, actualAttendees: 6, recusedCount: 1, pendingCount: 0 }), total_members: 8, actual_attendees: 6, recused_count: 1, pending_count: 0, eligible_count: 5, required_quorum: 4, meets_quorum: 1, computed_by: "user-secretariat-1", created_at: "2026-08-18T10:10:00.000Z" });
  await insert(db, "individual_votes", { id: "vote-001", agenda_id: "ag-001", meeting_id: "mtg-001", user_id: "user-director-1", option: "approve", reason: null, conditions: null, cast_at: "2026-08-18T10:20:00.000Z", etag_version: 1 });
  await insert(db, "individual_votes", { id: "vote-002", agenda_id: "ag-001", meeting_id: "mtg-001", user_id: "user-director-2", option: "approve_with_condition", reason: "従業員承継条件の履行状況を決議後アクションとして四半期報告に含めることを条件とする", conditions: "四半期報告", cast_at: "2026-08-18T10:21:00.000Z", etag_version: 1 });
  await insert(db, "individual_votes", { id: "vote-003", agenda_id: "ag-001", meeting_id: "mtg-001", user_id: "user-director-4", option: "oppose", reason: "クロージング前提条件のうち規制当局承認見込みが不十分", conditions: null, cast_at: "2026-08-18T10:22:00.000Z", etag_version: 1 });
  await insert(db, "individual_votes", { id: "vote-004", agenda_id: "ag-001", meeting_id: "mtg-001", user_id: "user-director-5", option: "approve", reason: null, conditions: null, cast_at: "2026-08-18T10:23:00.000Z", etag_version: 1 });
  await insert(db, "individual_votes", { id: "vote-005", agenda_id: "ag-001", meeting_id: "mtg-001", user_id: "user-director-6", option: "approve", reason: null, conditions: null, cast_at: "2026-08-18T10:24:00.000Z", etag_version: 1 });

  await insert(db, "eligibility_snapshots", { id: "elig-002", agenda_id: "ag-004", as_of: "2026-07-21T10:10:00.000Z", rule_version_id: "rule-board-v1", calculation_inputs: JSON.stringify({ formula: "majority", totalMembers: 8, actualAttendees: 6, recusedCount: 0, pendingCount: 0 }), total_members: 8, actual_attendees: 6, recused_count: 0, pending_count: 0, eligible_count: 6, required_quorum: 4, meets_quorum: 1, computed_by: "user-secretariat-1", created_at: "2026-07-21T10:10:00.000Z" });
  for (const [i, uid] of ["user-director-1", "user-director-2", "user-director-3", "user-director-4", "user-director-5", "user-director-6"].entries()) {
    await insert(db, "individual_votes", { id: `vote-10${i}`, agenda_id: "ag-004", meeting_id: "mtg-002", user_id: uid, option: "approve", reason: null, conditions: null, cast_at: "2026-07-21T10:20:00.000Z", etag_version: 1 });
  }
  const decManifest = await sealManifest(db, {
    manifestId: "MAN-2026-0001-v1",
    subjectType: "decision",
    subjectId: "dec-001",
    packageId: "pkg-003",
    fixedBy: "user-director-1",
    ruleVersionId: "rule-board-v1",
    eligibilitySnapshotId: "elig-002",
    votes: [
      { userId: "user-director-1", option: "approve" },
      { userId: "user-director-2", option: "approve" },
      { userId: "user-director-3", option: "approve" },
      { userId: "user-director-4", option: "approve" },
      { userId: "user-director-5", option: "approve" },
      { userId: "user-director-6", option: "approve" },
    ],
    tally: { approve: 6, approve_with_condition: 0, oppose: 0, abstain: 0, total: 6 },
    outcome: "passed",
    conditions: "保証枠の利用状況は毎四半期、取締役会へ報告する",
    dissent: null,
    fixedAt: "2026-07-21T11:00:00.000Z",
  });
  await insert(db, "decisions", { id: "dec-001", agenda_id: "ag-004", meeting_id: "mtg-002", status: "finalized", outcome: "passed", conditions: "保証枠の利用状況は毎四半期、取締役会へ報告する", dissent: null, tally: JSON.stringify({ approve: 6, approve_with_condition: 0, oppose: 0, abstain: 0, total: 6 }), decided_at: "2026-07-21T11:00:00.000Z", decided_by: "user-director-1", rule_version_id: "rule-board-v1", evidence_manifest_id: decManifest.id, previous_decision_id: null });
  await insert(db, "actions", { id: "act-001", decision_id: "dec-001", finding_id: null, agenda_id: "ag-004", title: "保証枠利用状況の四半期報告", description: "連結子会社の保証枠利用残高と返済計画を四半期ごとに取締役会へ報告する", owner_user_id: "user-owner-2", confirmer_user_id: "user-auditor-1", due_at: "2026-10-31T17:00:00.000Z", acceptance_criteria: "利用残高一覧と返済計画が提出され、独立確認者が確認していること", status: "in_progress", created_by: "user-secretariat-1", created_at: "2026-07-21T11:10:00.000Z", updated_at: "2026-07-22T09:00:00.000Z" });
  await insert(db, "action_events", { id: "actev-001", action_id: "act-001", event_type: "started", note: "報告準備を開始", evidence_sha256: null, by_user: "user-owner-2", at: "2026-07-22T09:00:00.000Z" });
  /* ---- 議事録（第11回 確定済み） ---- */
  await insert(db, "minutes", { id: "min-001", meeting_id: "mtg-002", status: "finalized", current_version_id: "minv-001", created_by: "user-secretariat-1", created_at: "2026-07-22T10:00:00.000Z" });
  await insert(db, "minutes_versions", { id: "minv-001", minutes_id: "min-001", version_no: 1, content: "第11回取締役会議事録（デモ）\n1. 連結子会社への債務保証枠設定を承認（満場一致）\n2. 保証枠利用状況の四半期報告を決議条件として付す", reason: null, created_by: "user-secretariat-1", created_at: "2026-07-22T10:00:00.000Z", sha256_full: await sha256Hex("第11回取締役会議事録（デモ）"), status: "finalized" });
  for (const [i, uid] of ["user-director-1", "user-director-2", "user-director-3", "user-director-4", "user-director-5", "user-director-6"].entries()) {
    await insert(db, "minutes_signatories", { id: `mins-00${i}`, version_id: "minv-001", user_id: uid, signed_at: "2026-07-23T10:00:00.000Z", verification_result: "ok", invalidated_at: null, invalidated_by: null });
  }
  await insert(db, "minutes", { id: "min-002", meeting_id: "mtg-001", status: "drafting", current_version_id: "minv-002", created_by: "user-secretariat-1", created_at: "2026-08-18T11:00:00.000Z" });
  await insert(db, "minutes_versions", { id: "minv-002", minutes_id: "min-002", version_no: 1, content: "第12回取締役会議事録（案）\n1. 子会社株式譲渡契約の締結について審議", reason: null, created_by: "user-secretariat-1", created_at: "2026-08-18T11:00:00.000Z", sha256_full: await sha256Hex("第12回取締役会議事録（案）"), status: "draft" });

  /* ---- 監査 ---- */
  const universes = [
    { id: "uni-001", name: "資金調達・財務報告", category: "財務", owner: "経理部", description: "資金調達、債務保証、財務報告に係る統制", status: "active", created_by: "user-audit-manager-1", created_at: "2026-04-01T00:00:00.000Z" },
    { id: "uni-002", name: "投資管理", category: "事業", owner: "経営戦略部", description: "子会社株式・事業投資の意思決定とモニタリング", status: "active", created_by: "user-audit-manager-1", created_at: "2026-04-01T00:00:00.000Z" },
    { id: "uni-003", name: "労務・コンプライアンス", category: "コンプライアンス", owner: "人事総務部", description: "労働時間管理、ハラスメント対応、社内規程遵守", status: "active", created_by: "user-audit-manager-1", created_at: "2026-04-01T00:00:00.000Z" },
    { id: "uni-004", name: "ITガバナンス", category: "IT", owner: "IT企画部", description: "システム更改、アクセス権限、データ保護", status: "active", created_by: "user-audit-manager-1", created_at: "2026-04-01T00:00:00.000Z" },
    { id: "uni-005", name: "取引先管理", category: "調達", owner: "調達部", description: "重要取引先の審査と契約管理", status: "active", created_by: "user-audit-manager-1", created_at: "2026-04-01T00:00:00.000Z" },
  ] as Row[];
  for (const u of universes) await insert(db, "audit_universes", u);
  const risks = [
    { id: "risk-001", universe_id: "uni-001", fiscal_year: 2026, inherent_risk: 4, control_risk: 2, score: 3, basis: "資金調達規模と保証枠の金額影響による", status: "assessed", assessed_by: "user-auditor-1", assessed_at: "2026-04-10T00:00:00.000Z" },
    { id: "risk-002", universe_id: "uni-002", fiscal_year: 2026, inherent_risk: 4, control_risk: 3, score: 4, basis: "投資判断の独断リスクと事後モニタリングの未確立", status: "assessed", assessed_by: "user-auditor-1", assessed_at: "2026-04-10T00:00:00.000Z" },
    { id: "risk-003", universe_id: "uni-003", fiscal_year: 2026, inherent_risk: 3, control_risk: 2, score: 3, basis: "長時間労働とハラスメント事案の発生状況", status: "assessed", assessed_by: "user-auditor-1", assessed_at: "2026-04-10T00:00:00.000Z" },
    { id: "risk-004", universe_id: "uni-004", fiscal_year: 2026, inherent_risk: 3, control_risk: 3, score: 3, basis: "特権ID管理と更改案件の増加", status: "assessed", assessed_by: "user-auditor-1", assessed_at: "2026-04-10T00:00:00.000Z" },
    { id: "risk-005", universe_id: "uni-005", fiscal_year: 2026, inherent_risk: 2, control_risk: 2, score: 2, basis: "取引先審査フローの整備状況", status: "assessed", assessed_by: "user-auditor-1", assessed_at: "2026-04-10T00:00:00.000Z" },
  ] as Row[];
  for (const r of risks) await insert(db, "risk_assessments", r);
  await insert(db, "annual_plans", { id: "ap-2026", fiscal_year: 2026, title: "2026年度内部監査計画", status: "approved", approved_by: "user-audit-manager-1", approved_at: "2026-04-15T00:00:00.000Z", items: JSON.stringify(["uni-001", "uni-002", "uni-003", "uni-004", "uni-005"]), created_by: "user-audit-manager-1", created_at: "2026-04-01T00:00:00.000Z" });
  await insert(db, "engagements", { id: "eng-001", annual_plan_id: "ap-2026", universe_id: "uni-001", title: "資金調達・財務報告プロセス監査", scope: "債務保証の設定・報告プロセスを中心に、2026年1月〜6月の取引を対象とする", status: "in_progress", start_on: "2026-07-01", end_on: "2026-09-30", owner_id: "user-auditor-1", independence_declared: 1, created_by: "user-audit-manager-1", created_at: "2026-06-01T00:00:00.000Z" });
  await insert(db, "engagements", { id: "eng-002", annual_plan_id: "ap-2026", universe_id: "uni-002", title: "投資管理プロセス監査", scope: "子会社株式の取得・譲渡に係る意思決定プロセス", status: "planned", start_on: "2026-10-01", end_on: "2026-12-31", owner_id: "user-auditor-2", independence_declared: 1, created_by: "user-audit-manager-1", created_at: "2026-06-01T00:00:00.000Z" });
  await insert(db, "procedures", { id: "proc-001", engagement_id: "eng-001", title: "債務保証設定プロセスのテスト", objective: "保証枠設定時の稟議・承認・記録の網羅性を確認する", population_count: 120, sample_count: 20, sampling_basis: "金額上位と無作為抽出の併用（乱数シード 20260701）", status: "in_progress", created_by: "user-auditor-1", created_at: "2026-07-05T00:00:00.000Z" });
  await insert(db, "procedures", { id: "proc-002", engagement_id: "eng-001", title: "報告プロセスのウォークスルー", objective: "保証枠利用状況の報告経路と証跡を確認する", population_count: 12, sample_count: 4, sampling_basis: "直近四半期全件", status: "planned", created_by: "user-auditor-1", created_at: "2026-07-05T00:00:00.000Z" });
  await insert(db, "workpapers", { id: "wp-001", procedure_id: "proc-001", title: "稟議・承認証跡のサンプル検査表", content: "サンプル20件の稟議書・承認記録・Evidence Manifest保存状況を検査した。", version_no: 1, author_id: "user-auditor-1", reviewer_id: "user-auditor-2", approver_id: null, status: "in_review", created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-25T00:00:00.000Z" });
  await insert(db, "workpaper_versions", { id: "wpv-001", workpaper_id: "wp-001", version_no: 1, content: "稟議・承認証跡のサンプル検査表（v1）", evidence_refs: JSON.stringify(["DOC-FIN-2026-008"]), created_by: "user-auditor-1", created_at: "2026-07-20T00:00:00.000Z", sha256_full: await sha256Hex("稟議・承認証跡のサンプル検査表（v1）") });
  await insert(db, "review_signoffs", { id: "rev-001", workpaper_id: "wp-001", reviewer_id: "user-auditor-2", decision: "pending", comment: null, version_no: 1, created_at: "2026-07-25T00:00:00.000Z" });
  await insert(db, "workpapers", { id: "wp-002", procedure_id: "proc-001", title: "サンプル検査の例外一覧", content: "サンプル20件中2件で承認記録のEvidence保存漏れを確認。", version_no: 1, author_id: "user-auditor-1", reviewer_id: null, approver_id: null, status: "draft", created_at: "2026-07-26T00:00:00.000Z", updated_at: "2026-07-26T00:00:00.000Z" });
  await insert(db, "workpaper_versions", { id: "wpv-002", workpaper_id: "wp-002", version_no: 1, content: "サンプル検査の例外一覧（v1）", evidence_refs: JSON.stringify(["DOC-FIN-2026-008"]), created_by: "user-auditor-1", created_at: "2026-07-26T00:00:00.000Z", sha256_full: await sha256Hex("サンプル検査の例外一覧（v1）") });

  const findings = [
    { id: "fnd-001", engagement_id: "eng-001", workpaper_id: "wp-002", title: "保証枠設定時のEvidence保存漏れ", criterion: "社内規程 記録管理細則 第12条", fact: "サンプル20件中2件で承認記録のEvidence Manifest保存が確認できなかった", cause: "承認プロセスと記録保存の運用が分離しており、保存漏れの検知機能がない", impact: "結論根拠の再現性が低下する", recommendation: "承認時に自動でEvidence保存を促す運用と、月次チェックを導入する", severity: "medium", status: "draft", finalized_by: null, finalized_at: null, created_by: "user-auditor-1", created_at: "2026-07-26T00:00:00.000Z" },
    { id: "fnd-002", engagement_id: "eng-001", workpaper_id: "wp-002", title: "保証枠の上限管理における二重承認", criterion: "取締役会規程 第10条", fact: "上限100億円の保証枠設定において、稟議承認と取締役会決議の順序が一部逆転していた", cause: "手続の順序を確認するチェックリストが存在しない", impact: "取締役会決議前に実質的なコミットメントが発生するリスク", recommendation: "チェックリスト導入と、逆転発生時の是正報告手順の明確化", severity: "high", status: "finalized", finalized_by: "user-audit-manager-1", finalized_at: "2026-08-01T00:00:00.000Z", created_by: "user-auditor-1", created_at: "2026-07-27T00:00:00.000Z" },
    { id: "fnd-003", engagement_id: "eng-001", workpaper_id: "wp-002", title: "報告対象範囲の記載漏れ", criterion: "決議条件に基づく報告ルール", fact: "保証枠利用状況の報告対象に一部子会社が含まれていなかった", cause: "報告対象一覧が稟議書に明記されていなかった", impact: "取締役会への報告網羅性が低下", recommendation: "報告対象一覧の標準様式化", severity: "low", status: "awaiting_response", finalized_by: "user-audit-manager-1", finalized_at: "2026-08-02T00:00:00.000Z", created_by: "user-auditor-1", created_at: "2026-07-28T00:00:00.000Z" },
    { id: "fnd-004", engagement_id: "eng-001", workpaper_id: "wp-002", title: "稟議書の版管理不備", criterion: "文書管理規程 第8条", fact: "承認後に稟議書が改版され、最終版の確定日時が不明", cause: "版管理が手作業", impact: "審議時点の内容と最終版の差異検証が困難", recommendation: "文書管理システムへの移行とハッシュ固定", severity: "medium", status: "remediating", finalized_by: "user-audit-manager-1", finalized_at: "2026-08-03T00:00:00.000Z", created_by: "user-auditor-1", created_at: "2026-07-29T00:00:00.000Z" },
    { id: "fnd-005", engagement_id: "eng-001", workpaper_id: "wp-002", title: "承認フローの証跡保存ルール未周知", criterion: "記録管理細則 第5条", fact: "承認フローの証跡をEvidenceとして保存するルールが一部部署に周知されていなかった", cause: "規程改定時の周知漏れ", impact: "証跡の散逸リスク", recommendation: "全関係部署への周知と受領確認", severity: "low", status: "closed", finalized_by: "user-audit-manager-1", finalized_at: "2026-08-01T00:00:00.000Z", created_by: "user-auditor-1", created_at: "2026-07-28T00:00:00.000Z" },
    { id: "fnd-006", engagement_id: "eng-001", workpaper_id: "wp-002", title: "モニタリング報告の遅延", criterion: "決議条件", fact: "保証枠利用状況の四半期報告が1回、締切超過", cause: "データ収集の手作業と担当者依存", impact: "監督の実効性低下", recommendation: "報告データの自動集計化", severity: "medium", status: "reopened", finalized_by: "user-audit-manager-1", finalized_at: "2026-08-05T00:00:00.000Z", created_by: "user-auditor-1", created_at: "2026-08-01T00:00:00.000Z" },
    { id: "fnd-007", engagement_id: "eng-001", workpaper_id: "wp-002", title: "モニタリング報告の遅延（再オープン）", criterion: "決議条件", fact: "再検証の結果、再発事案を確認", cause: "自動集計化が未完了", impact: "監督の実効性低下が継続", recommendation: "自動集計化の完了と月次レビュー", severity: "medium", status: "reopened", finalized_by: null, finalized_at: null, created_by: "user-auditor-1", created_at: "2026-08-10T00:00:00.000Z" },
  ] as Row[];
  for (const f of findings) await insert(db, "findings", f);
  await insert(db, "actions", { id: "act-002", decision_id: null, finding_id: "fnd-005", agenda_id: null, title: "承認フローの証跡保存ルール周知", description: "承認記録をEvidence Manifestとして保存する運用を関係部署へ周知する", owner_user_id: "user-owner-2", confirmer_user_id: "user-auditor-2", due_at: "2026-08-15T17:00:00.000Z", acceptance_criteria: "周知メールと受領確認が保存されている", status: "evidence_submitted", created_by: "user-audit-manager-1", created_at: "2026-08-01T10:00:00.000Z", updated_at: "2026-08-10T09:00:00.000Z" });
  await insert(db, "action_events", { id: "actev-002", action_id: "act-002", event_type: "evidence_submitted", note: "周知メール・受領確認を提出", evidence_sha256: await sha256Hex("周知メール"), by_user: "user-owner-2", at: "2026-08-10T09:00:00.000Z" });
  await insert(db, "management_responses", { id: "resp-001", finding_id: "fnd-003", agree: 1, response_text: "報告対象一覧の標準様式を導入し、8月末までに全対象を確定する", plan: "様式改定と対象一覧の整備", due_at: "2026-08-31T17:00:00.000Z", respondent_id: "user-owner-2", status: "submitted", created_at: "2026-08-05T00:00:00.000Z" });
  await insert(db, "management_responses", { id: "resp-002", finding_id: "fnd-004", agree: 1, response_text: "文書管理システムへ移行し、ハッシュ固定を開始する", plan: "移行計画の策定", due_at: "2026-09-30T17:00:00.000Z", respondent_id: "user-owner-2", status: "submitted", created_at: "2026-08-06T00:00:00.000Z" });
  await insert(db, "remediations", { id: "rem-001", finding_id: "fnd-004", description: "文書管理システム移行・ハッシュ固定の完了報告", due_at: "2026-09-30T17:00:00.000Z", owner_id: "user-owner-2", status: "in_progress", evidence_manifest_id: null, created_at: "2026-08-06T00:00:00.000Z" });
  await insert(db, "management_responses", { id: "resp-003", finding_id: "fnd-005", agree: 1, response_text: "周知メールを送付し受領確認を取得済み", plan: null, due_at: "2026-08-10T17:00:00.000Z", respondent_id: "user-owner-2", status: "submitted", created_at: "2026-08-05T00:00:00.000Z" });
  const retestManifest = await sealManifest(db, {
    manifestId: "MAN-2026-0002-v1",
    subjectType: "retest",
    subjectId: "ret-001",
    fixedBy: "user-auditor-2",
    votes: [],
    tally: {},
    outcome: "closed",
    note: "周知メールと受領確認を確認し、是正完了と判断",
    fixedAt: "2026-08-11T00:00:00.000Z",
    previousManifestId: null,
  });
  await insert(db, "retests", { id: "ret-001", finding_id: "fnd-005", tester_id: "user-auditor-2", result: "closed", note: "周知メールと受領確認を確認し、是正完了と判断", tested_at: "2026-08-11T00:00:00.000Z", evidence_manifest_id: retestManifest.id, reopened_finding_id: null });
  await insert(db, "retests", { id: "ret-002", finding_id: "fnd-006", tester_id: "user-auditor-2", result: "reopened", note: "再発事案を確認し再オープン", tested_at: "2026-08-12T00:00:00.000Z", evidence_manifest_id: null, reopened_finding_id: "fnd-007" });

  /* ---- 保持・法的保全・廃棄候補 ---- */
  await insert(db, "retention_rules", { id: "ret-rule-001", record_type: "minutes", trigger: "meeting_held", years: 10, version: 1, effective_from: "2026-04-01T00:00:00.000Z", status: "active" });
  await insert(db, "retention_rules", { id: "ret-rule-002", record_type: "agenda_item", trigger: "decision", years: 10, version: 1, effective_from: "2026-04-01T00:00:00.000Z", status: "active" });
  await insert(db, "retention_rules", { id: "ret-rule-003", record_type: "finding", trigger: "closed", years: 7, version: 1, effective_from: "2026-04-01T00:00:00.000Z", status: "active" });
  await insert(db, "legal_holds", { id: "hold-001", scope_type: "minutes", scope_id: "mtg-002", reason: "株主総会関連の証拠保全（デモ）", started_by: "user-legal-1", started_at: "2026-07-25T00:00:00.000Z", released_by: null, released_at: null, status: "active" });
  await insert(db, "disposal_candidates", { id: "disp-001", record_type: "minutes", record_id: "mtg-002", expires_at: "2036-07-22T00:00:00.000Z", status: "pending_approval", legal_hold_checked_at: "2026-08-10T00:00:00.000Z", requested_by: "user-records-1", approved_by: null, executed_by: null, executed_at: null, certificate_hash: null });
  await insert(db, "disposal_candidates", { id: "disp-002", record_type: "finding", record_id: "fnd-001", expires_at: "2033-07-27T00:00:00.000Z", status: "candidate", legal_hold_checked_at: null, requested_by: null, approved_by: null, executed_by: null, executed_at: null, certificate_hash: null });

  /* ---- AI草案（保存済み1件・レビュー待ち1件） ---- */
  await insert(db, "ai_drafts", { id: "ai-001", agenda_id: "ag-002", body: "【AI草案（デモ・規則ベース）】議案: 中期経営計画2027年度方針の承認\n論点整理:\n1. 中期経営計画方針骨子（出典1）\n2. ROE 10%以上、連結売上高 CAGR 5%（出典1）\n信頼限界: 本草案は人の承認まで正式記録になりません。", citations: JSON.stringify([{ index: 1, title: "中期経営計画方針骨子", sourceId: "DOC-PLAN-2026-031", sourceVersion: "v2", locator: "1. 基本方針" }]), status: "reviewed", created_by: "user-auditor-1", created_at: "2026-08-12T08:00:00.000Z", reviewed_by: "user-audit-manager-1", reviewed_at: "2026-08-12T08:30:00.000Z", saved_at: null, shared_at: null });
  await insert(db, "ai_drafts", { id: "ai-002", agenda_id: "ag-001", body: "【AI草案（デモ・規則ベース）】議案: 子会社みらいエナジー株式会社 株式譲渡契約の締結\n論点整理:\n1. 譲渡価額は評価レンジ内（580億〜620億円）（出典1）\n2. 従業員承継条件の確定がクロージング前提条件（出典2）\n信頼限界: 本草案は人の承認まで正式記録になりません。", citations: JSON.stringify([{ index: 1, title: "株式譲渡契約書ドラフト", sourceId: "DOC-CONTRACT-2026-014", sourceVersion: "v3", locator: "第4条" }, { index: 2, title: "デューデリジェンス報告書要約", sourceId: "DOC-DD-2026-007", sourceVersion: "v1", locator: "第5章" }]), status: "saved", created_by: "user-auditor-1", created_at: "2026-08-12T08:10:00.000Z", reviewed_by: "user-audit-manager-1", reviewed_at: "2026-08-12T08:40:00.000Z", saved_at: "2026-08-12T09:00:00.000Z", shared_at: null });

  /* ---- 通知 ---- */
  await notifyUser(db, "user-director-1", "招集通知", "2026年8月 取締役会（第12回）の招集が発出されました", "convocation", "meeting", "mtg-001");
  await notifyUser(db, "user-director-2", "招集通知", "2026年8月 取締役会（第12回）の招集が発出されました", "convocation", "meeting", "mtg-001");
  await notifyUser(db, "user-director-3", "招集通知", "2026年8月 取締役会（第12回）の招集が発出されました", "convocation", "meeting", "mtg-001");
  await notifyUser(db, "user-owner-2", "履行タスクが割り当てられました", "保証枠利用状況の四半期報告", "action", "action", "act-001");
  await notifyUser(db, "user-auditor-1", "独立確認の依頼", "保証枠利用状況の四半期報告", "action_confirm", "action", "act-001");
  await notifyUser(db, "user-owner-2", "履行タスクが割り当てられました", "承認フローの証跡保存ルール周知", "action", "action", "act-002");
  await notifyUser(db, "user-auditor-2", "独立確認の依頼", "承認フローの証跡保存ルール周知", "action_confirm", "action", "act-002");
  await notifyUser(db, "user-auditor-1", "経営回答が提出されました", "報告対象範囲の記載漏れ", "finding_response", "finding", "fnd-003");
  await notifyUser(db, "user-owner-2", "指摘が確定されました", "保証枠の上限管理における二重承認", "finding_finalized", "finding", "fnd-002");
  await notifyUser(db, "user-auditor-2", "調書のレビュー依頼", "稟議・承認証跡のサンプル検査表のレビューが開始されました", "workpaper_review", "workpaper", "wp-001");

  /* ---- 監査イベントチェーン ---- */
  const events: Array<[string, string, string, string, string]> = [
    ["user-secretariat-1", "seed.demo", "system", "seed", "デモ初期データ投入"],
    ["user-owner-1", "agenda.create", "agenda_item", "ag-001", "議案作成"],
    ["user-secretariat-1", "package.fix", "agenda_item", "ag-001", "資料固定"],
    ["user-director-3", "conflict.declare", "agenda_item", "ag-001", "利益相反申告"],
    ["user-secretariat-1", "conflict.determine", "conflict", "coi-001", "忌避判定"],
    ["user-secretariat-1", "meeting.status", "meeting", "mtg-001", "会議開始"],
    ["user-director-1", "agenda.vote", "agenda_item", "ag-001", "議決"],
    ["user-director-2", "agenda.vote", "agenda_item", "ag-001", "条件付賛成"],
    ["user-director-4", "agenda.vote", "agenda_item", "ag-001", "反対"],
    ["user-auditor-1", "audit.workpaper.create", "workpaper", "wp-001", "調書作成"],
    ["user-auditor-2", "audit.workpaper.review_request", "workpaper", "wp-001", "レビュー依頼"],
    ["user-audit-manager-1", "audit.finding.finalize", "finding", "fnd-002", "指摘確定"],
    ["user-owner-2", "audit.finding.respond", "finding", "fnd-003", "経営回答"],
    ["user-owner-2", "audit.finding.remediate", "finding", "fnd-004", "是正開始"],
    ["user-auditor-2", "audit.finding.retest", "finding", "fnd-005", "再検証・終結"],
    ["user-auditor-2", "audit.finding.retest", "finding", "fnd-006", "再検証・再オープン"],
    ["user-legal-1", "legalhold.start", "legal_hold", "hold-001", "法的保全開始"],
    ["user-records-1", "disposal.request", "disposal_candidate", "disp-001", "廃棄申請"],
    ["user-auditor-1", "ai.draft.create", "agenda_item", "ag-002", "AI草案生成"],
    ["user-audit-manager-1", "ai.draft.review", "ai_draft", "ai-001", "AI草案レビュー"],
    ["user-audit-manager-1", "ai.draft.save", "ai_draft", "ai-002", "AI草案保存"],
  ];
  for (const [actor, action, resourceType, resourceId, reason] of events) {
    await writeAuditEvent(db, { actorId: actor, action, resourceType, resourceId, reason, correlationId: "seed" });
  }
  await writeAuditEvent(db, { actorId: "user-director-1", action: "decision.finalize", resourceType: "agenda_item", resourceId: "ag-004", resourceVersion: "passed", reason: "債務保証枠設定の決議", correlationId: "seed" });

  count.bodies = 3;
  count.meetings = 3;
  count.agendaItems = 6;
  count.findings = 7;
  count.auditEvents = (await db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM audit_events"))?.cnt ?? 0;
  count.manifests = (await db.first<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM evidence_manifests"))?.cnt ?? 0;
  return count;
}
