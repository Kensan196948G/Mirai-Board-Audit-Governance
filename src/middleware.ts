import type { Context, Next } from "hono";
import { verifySession } from "./auth.ts";
import { AppError } from "./errors.ts";
import type { Permission } from "./permissions.ts";
import { can } from "./permissions.ts";
import { hasActiveEmergencyGrant } from "./services/access-control.ts";
import type { AppDeps } from "./app.ts";
import type { SessionUser, UserRole } from "./types.ts";

export type AppVars = {
  deps: AppDeps;
  user: SessionUser;
  correlationId: string;
};

export async function corsMiddleware(c: Context<{ Variables: AppVars }>, next: Next) {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  c.header("Access-Control-Allow-Headers", "authorization,content-type,x-seed-key");
  c.header("Access-Control-Max-Age", "86400");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.set("correlationId", `req_${crypto.randomUUID().slice(0, 8)}`);
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }
  await next();
}

export async function authMiddleware(c: Context<{ Variables: AppVars }>, next: Next) {
  const deps = c.get("deps");
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = token ? await verifySession(token, deps.sessionSecret) : null;
  if (!payload) {
    throw new AppError("FORBIDDEN", "認証が必要です", 401);
  }
  const row = await deps.db.first<Record<string, unknown>>("SELECT * FROM users WHERE id = ? AND active = 1", payload.sub);
  if (!row) {
    throw new AppError("FORBIDDEN", "認証が必要です", 401);
  }
  const user: SessionUser = {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role) as UserRole,
    title: String(row.title),
    department: String(row.department),
    outside: Number(row.outside) === 1,
    bodyIds: JSON.parse(String(row.body_ids ?? "[]")) as string[],
  };
  c.set("user", user);
  await next();
}

export function requirePerm(...perms: Permission[]) {
  return async (c: Context<{ Variables: AppVars }>, next: Next) => {
    const user = c.get("user");
    if (perms.some((p) => can(user.role, p))) {
      await next();
      return;
    }
    // ロール権限に無い場合のみ、緊急権限（バックログB-09）の有無をDBで確認する
    const deps = c.get("deps");
    for (const p of perms) {
      if (await hasActiveEmergencyGrant(deps.db, user.id, p)) {
        await next();
        return;
      }
    }
    throw new AppError("NOT_FOUND", "対象が見つかりません", 404);
  };
}

/* シンプルなレート制限（デモ用・プロセス内） */
const loginAttempts = new Map<string, number[]>();

export function rateLimit(key: string, limit = 20, windowMs = 60_000): void {
  const now = Date.now();
  const list = (loginAttempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    throw new AppError("FORBIDDEN", "試行回数が多すぎます。しばらく待ってください", 429);
  }
  list.push(now);
  loginAttempts.set(key, list);
}
