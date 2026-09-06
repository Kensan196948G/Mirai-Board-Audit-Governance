import { Hono } from "hono";
import type { Db } from "./db/types.ts";
import { createErrorResponse, handleError } from "./errors.ts";
import { corsMiddleware, type AppVars } from "./middleware.ts";
import { authRoutes } from "./routes/auth.ts";
import { oidcRoutes } from "./routes/oidc.ts";
import { meetingsRoutes } from "./routes/meetings.ts";
import { agendaRoutes } from "./routes/agenda.ts";
import { auditRoutes } from "./routes/audit.ts";
import { evidenceRoutes } from "./routes/evidence.ts";
import { retentionRoutes } from "./routes/retention.ts";
import { adminRoutes } from "./routes/admin.ts";
import { connectorRoutes } from "./routes/connectors.ts";
import { aiRoutes } from "./routes/ai.ts";
import { seedAll } from "./seed.ts";

export type AppDeps = {
  db: Db;
  sessionSecret: string;
  seedKey?: string;
  environment: string;
  assets?: Fetcher;
  assetRoot?: string;
  /** バックログ B-03: 実メールプロバイダ設定（未設定時は console プロバイダで安全に動作） */
  email?: { provider?: string; webhookUrl?: string; webhookSecret?: string };
  /** バックログ B-04: 正本外部連携（Webhook署名検証用の共有鍵。未設定時は受信を拒否） */
  connectorWebhookSecret?: string;
  /** バックログ B-04: 正本の文書管理システムへの送信先（未設定時は該当コネクタが無効） */
  documentManagementWebhookUrl?: string;
  /** バックログ B-02: OIDC/SSO本実装設定（未設定時は /api/auth/oidc/* が501を返す） */
  oidc?: { issuer?: string; clientId?: string; clientSecret?: string; redirectUri?: string };
};

export function buildApp(deps: AppDeps) {
  const app = new Hono<{ Variables: AppVars }>();
  app.use("*", corsMiddleware);
  app.use("/api/*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.get("/api/health", (c) =>
    c.json({ ok: true, app: "mirai-board-audit-governance", environment: deps.environment, at: new Date().toISOString() }),
  );

  app.get("/api/users", async (c) => {
    const users = await deps.db.all<Record<string, unknown>>(
      "SELECT id, name, role, title, department, outside FROM users WHERE active = 1 ORDER BY role, name",
    );
    return c.json({ items: users, total: users.length });
  });

  app.post("/api/dev/seed", async (c) => {
    const key = c.req.header("x-seed-key") ?? "";
    if (!deps.seedKey || key !== deps.seedKey) {
      return createErrorResponse(c, "FORBIDDEN", "シード実行が許可されていません", { status: 403 });
    }
    const summary = await seedAll(deps.db);
    return c.json({ ok: true, summary });
  });

  app.route("/api/auth", authRoutes());
  app.route("/api/auth", oidcRoutes());
  app.route("/api", meetingsRoutes());
  app.route("/api", agendaRoutes());
  app.route("/api", auditRoutes());
  app.route("/api", evidenceRoutes());
  app.route("/api", retentionRoutes());
  app.route("/api", adminRoutes());
  app.route("/api", connectorRoutes());
  app.route("/api/ai", aiRoutes());

  app.notFound((c) => createErrorResponse(c, "NOT_FOUND", "対象が見つかりません", { status: 404 }));
  app.onError(handleError);

  return app;
}
