/** cron・Webhook受信等、人間のユーザーが介在しない操作の監査ログ主体（users テーブルにサービスアカウントとして存在） */
export const SYSTEM_ACTOR_ID = "system-automation";

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256Hex(text: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((buf) => {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  });
}
