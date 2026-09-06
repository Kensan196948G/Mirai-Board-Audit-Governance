import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTestApp, get, login, post } from "../helpers.ts";
import { sweepAccessControl } from "../../src/services/access-control.ts";

describe("四半期アクセス再認証・緊急権限の自動失効（B-09）", () => {
  it("再認証を過去日で登録するとスイープで対象ユーザーが非活性化される", async () => {
    const { app, db } = await createTestApp();
    const admin = await login(app, "user-admin-1");
    const certify = await post(app, "/api/access/certifications", admin, {
      userId: "user-owner-1",
      cycle: "2026-Q1",
      days: 1,
    });
    assert.equal(certify.status, 201);
    // 認証済み期限を過去に書き換えて期限切れをシミュレート
    await db.run("UPDATE access_certifications SET expires_at = '2020-01-01T00:00:00.000Z' WHERE user_id = 'user-owner-1'");
    const sweep = await sweepAccessControl(db);
    assert.equal(sweep.deactivatedUsers.includes("user-owner-1"), true);
    const stillLogin = await login(app, "user-owner-1");
    const me = await get(app, "/api/auth/me", stillLogin);
    assert.equal(me.status, 401);
  });

  it("非管理者は再認証を登録できない（404）", async () => {
    const { app } = await createTestApp();
    const owner = await login(app, "user-owner-1");
    const res = await post(app, "/api/access/certifications", owner, { userId: "user-owner-1", cycle: "2026-Q1" });
    assert.equal(res.status, 404);
  });

  it("緊急権限は期限切れでスイープすると失効し、手動失効は409で二重処理を防ぐ", async () => {
    const { app, db } = await createTestApp();
    const admin = await login(app, "user-admin-1");
    const grant = await post(app, "/api/access/emergency-grants", admin, {
      userId: "user-owner-1",
      permission: "disposal:manage",
      reason: "障害対応のため一時的に付与",
      expiresInHours: 1,
    });
    assert.equal(grant.status, 201);
    const body = (await grant.json()) as { item: { id: string } };
    await db.run("UPDATE emergency_access_grants SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", body.item.id);
    const sweep = await sweepAccessControl(db);
    assert.equal(sweep.expiredGrants, 1);
    const revokeAgain = await post(app, `/api/access/emergency-grants/${body.item.id}/revoke`, admin, {});
    assert.equal(revokeAgain.status, 409);
  });
});

describe("PDF帳票のサーバ生成（B-05）", () => {
  it("Evidence PackageのPDFが取得できる", async () => {
    const { app } = await createTestApp();
    const secretariat = await login(app, "user-secretariat-1");
    const manifests = await get(app, "/api/manifests", secretariat);
    const list = (await manifests.json()) as { items: Array<{ id: string }> };
    assert.ok(list.items.length > 0);
    const pdf = await get(app, `/api/evidence-packages/${list.items[0]!.id}/pdf`, secretariat);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  });

  it("議事録のPDFが取得できる", async () => {
    const { app } = await createTestApp();
    const secretariat = await login(app, "user-secretariat-1");
    const pdf = await get(app, "/api/minutes/minv-001/pdf", secretariat);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
  });

  it("廃棄実行後に廃棄証明書PDFが取得でき、未実行では409", async () => {
    const { app } = await createTestApp();
    const records = await login(app, "user-records-1");
    const admin = await login(app, "user-admin-1");
    const notYet = await get(app, "/api/disposals/disp-001/certificate.pdf", admin);
    assert.equal(notYet.status, 409);
    await post(app, "/api/disposals/disp-001/approve", admin, {});
    await post(app, "/api/legal-holds/hold-001/release", records, { reason: "解除" });
    const execute = await post(app, "/api/disposals/disp-001/execute", admin, {});
    assert.equal(execute.status, 200);
    const pdf = await get(app, "/api/disposals/disp-001/certificate.pdf", admin);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
  });
});

describe("通知の高度化（B-11）", () => {
  it("未受領通知をエスカレーションでき、受領済みは409", async () => {
    const { app } = await createTestApp();
    const director = await login(app, "user-director-1");
    const list = await get(app, "/api/users/me/notifications", director);
    const body = (await list.json()) as { items: Array<{ id: string; status: string }> };
    const unread = body.items.find((n) => n.status !== "acknowledged");
    assert.ok(unread);
    const escalate = await post(app, `/api/notifications/${unread!.id}/escalate`, director, { escalatedTo: "user-secretariat-1" });
    assert.equal(escalate.status, 200);
    await post(app, `/api/notifications/${unread!.id}/acknowledge`, director, {});
    const again = await post(app, `/api/notifications/${unread!.id}/escalate`, director, { escalatedTo: "user-secretariat-1" });
    assert.equal(again.status, 409);
  });

  it("再送信は配送記録を残す（既定はconsoleプロバイダで常に成功）", async () => {
    const { app } = await createTestApp();
    const director = await login(app, "user-director-1");
    const list = await get(app, "/api/users/me/notifications", director);
    const body = (await list.json()) as { items: Array<{ id: string }> };
    const target = body.items[0]!;
    const redeliver = await post(app, `/api/notifications/${target.id}/redeliver`, director, {});
    assert.equal(redeliver.status, 200);
    const result = (await redeliver.json()) as { item: { status: string } };
    assert.equal(result.item.status, "sent");
  });
});

describe("正本外部連携（B-04）", () => {
  it("Webhook未設定時は受信を拒否する（フェイルクローズ）", async () => {
    const { app } = await createTestApp();
    const res = await app.request("/api/connectors/document-management/inbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recordType: "minutes", recordId: "mtg-001" }),
    });
    assert.equal(res.status, 403);
  });

  it("管理者は連携状況を確認できる", async () => {
    const { app } = await createTestApp();
    const admin = await login(app, "user-admin-1");
    const res = await get(app, "/api/admin/external-connectors", admin);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: Array<{ name: string; configured: boolean }> };
    assert.equal(body.items[0]!.configured, false);
  });
});

describe("OIDC/SSOスタブ（B-02）", () => {
  it("未設定の間は501を返し、既存のデモログインには影響しない", async () => {
    const { app } = await createTestApp();
    const authorize = await app.request("/api/auth/oidc/authorize");
    assert.equal(authorize.status, 501);
    const demoLogin = await login(app, "user-director-1");
    assert.ok(demoLogin.length > 0);
  });
});
