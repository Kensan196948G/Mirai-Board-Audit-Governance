import { buildApp } from "./app.ts";
import { D1Db } from "./db/d1.ts";
import { sweepAccessControl } from "./services/access-control.ts";
import { SYSTEM_ACTOR_ID } from "./ids.ts";

type WorkerEnv = Env & {
  SESSION_SECRET?: string;
  SEED_KEY?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_WEBHOOK_URL?: string;
  EMAIL_WEBHOOK_SECRET?: string;
  CONNECTOR_WEBHOOK_SECRET?: string;
  DOCUMENT_MANAGEMENT_WEBHOOK_URL?: string;
  DOCUMENT_MANAGEMENT_WEBHOOK_SECRET?: string;
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_REDIRECT_URI?: string;
};

let cachedApp: ReturnType<typeof buildApp> | null = null;

function buildDeps(env: WorkerEnv) {
  return {
    db: new D1Db(env.DB),
    sessionSecret: env.SESSION_SECRET ?? "",
    seedKey: env.SEED_KEY,
    environment: env.ENVIRONMENT ?? "preview",
    assets: env.ASSETS,
    email: {
      provider: env.EMAIL_PROVIDER,
      webhookUrl: env.EMAIL_WEBHOOK_URL,
      webhookSecret: env.EMAIL_WEBHOOK_SECRET,
    },
    connectorWebhookSecret: env.CONNECTOR_WEBHOOK_SECRET,
    documentManagementWebhookUrl: env.DOCUMENT_MANAGEMENT_WEBHOOK_URL,
    documentManagementWebhookSecret: env.DOCUMENT_MANAGEMENT_WEBHOOK_SECRET,
    oidc: {
      issuer: env.OIDC_ISSUER,
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      redirectUri: env.OIDC_REDIRECT_URI,
    },
  };
}

export default {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    if (!cachedApp) {
      cachedApp = buildApp(buildDeps(env));
    }
    const app = cachedApp;
    return app.fetch(request, env, ctx);
  },
  /** バックログ B-09: 四半期アクセス再認証・緊急権限の自動失効（Cron Trigger） */
  async scheduled(_event: ScheduledController, env: WorkerEnv, _ctx: ExecutionContext) {
    const deps = buildDeps(env);
    const result = await sweepAccessControl(deps.db, { actorId: SYSTEM_ACTOR_ID });
    console.info("[cron] access-control sweep", JSON.stringify(result));
  },
};
