import { Hono } from "hono";
import { sessionExpiry, signSession } from "../auth.ts";
import {
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  isOidcConfigured,
  newNonce,
  newState,
  verifyIdToken,
  type OidcConfig,
} from "../auth-providers/oidc.ts";
import { writeAuditEvent } from "../audit.ts";
import { AppError } from "../errors.ts";
import { nowIso, uuid, SYSTEM_ACTOR_ID } from "../ids.ts";
import { permissionsFor } from "../permissions.ts";
import type { AppVars } from "../middleware.ts";
import type { SessionUser, UserRole } from "../types.ts";

const ATTEMPT_TTL_MINUTES = 10;

function toSessionUser(row: Record<string, unknown>): SessionUser {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role) as UserRole,
    title: String(row.title),
    department: String(row.department),
    outside: Number(row.outside) === 1,
    bodyIds: JSON.parse(String(row.body_ids ?? "[]")) as string[],
  };
}

/**
 * OIDC/SSOログインの下地ルート（バックログ B-02）。
 * `deps.oidc` が未設定の間は常に 501 を返し、既存のデモログイン（/api/auth/login）には影響しない。
 * 実IdP接続後も、検証済みメールアドレスが `users` テーブルの既存アクティブユーザーと一致しない
 * 限りログインを許可しない（フェイルクローズ。自動プロビジョニングはしない）。
 */
export function oidcRoutes() {
  const app = new Hono<{ Variables: AppVars }>();

  app.get("/oidc/authorize", async (c) => {
    const deps = c.get("deps");
    const config = deps.oidc;
    if (!isOidcConfigured(config ?? {})) {
      throw new AppError("VALIDATION", "OIDC/SSOは未設定です", 501);
    }
    const cfg = config as OidcConfig;
    const { verifier, challenge } = await generatePkce();
    const state = newState();
    const nonce = newNonce();
    const now = nowIso();
    const expiresAt = new Date(Date.now() + ATTEMPT_TTL_MINUTES * 60_000).toISOString();
    await deps.db.run(
      "INSERT INTO oidc_login_attempts (id, state, code_verifier, nonce, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      uuid(),
      state,
      verifier,
      nonce,
      now,
      expiresAt,
    );
    const url = await buildAuthorizeUrl(cfg, { state, nonce, codeChallenge: challenge });
    return c.redirect(url, 302);
  });

  app.get("/oidc/callback", async (c) => {
    const deps = c.get("deps");
    const config = deps.oidc;
    if (!isOidcConfigured(config ?? {})) {
      throw new AppError("VALIDATION", "OIDC/SSOは未設定です", 501);
    }
    const cfg = config as OidcConfig;
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) throw new AppError("VALIDATION", "code/stateが不足しています", 400);
    const attempt = await deps.db.first<Record<string, unknown>>(
      "SELECT * FROM oidc_login_attempts WHERE state = ? AND consumed_at IS NULL",
      state,
    );
    if (!attempt || String(attempt.expires_at) < nowIso()) {
      throw new AppError("FORBIDDEN", "ログイン試行が無効です。やり直してください", 403);
    }
    await deps.db.run("UPDATE oidc_login_attempts SET consumed_at = ? WHERE id = ?", nowIso(), String(attempt.id));

    const { idToken } = await exchangeCode(cfg, code, String(attempt.code_verifier));
    const verified = await verifyIdToken(cfg, idToken, String(attempt.nonce));
    if (!verified.email) throw new AppError("FORBIDDEN", "IdPからメールアドレスが取得できません", 403);

    const row = await deps.db.first<Record<string, unknown>>(
      "SELECT * FROM users WHERE email = ? AND active = 1",
      verified.email,
    );
    if (!row) {
      await writeAuditEvent(deps.db, {
        actorId: SYSTEM_ACTOR_ID,
        action: "auth.oidc_login_denied",
        resourceType: "user",
        resourceId: verified.email,
        result: "denied",
        reason: "no matching active user",
        correlationId: c.get("correlationId"),
      });
      throw new AppError("FORBIDDEN", "認証に失敗しました", 401);
    }
    const user = toSessionUser(row);
    const token = await signSession(
      { sub: user.id, role: user.role, iat: Math.floor(Date.now() / 1000), exp: sessionExpiry() },
      deps.sessionSecret,
    );
    await writeAuditEvent(deps.db, {
      actorId: user.id,
      action: "auth.oidc_login",
      resourceType: "user",
      resourceId: user.id,
      correlationId: c.get("correlationId"),
    });
    return c.json({ token, user, permissions: permissionsFor(user.role) });
  });

  return app;
}
