#!/usr/bin/env node
// バックログ B-08: バックアップ・復元試験（D1 Time Travel）
//
// D1はTime Travel機能で過去30日以内の任意時点へ復元できる。本スクリプトは
// 実行手順を固定化し、RPO/RTOを計測するための補助ツール。実行には
// Cloudflareへの認証（wrangler login 済み、または CLOUDFLARE_API_TOKEN）が必要。
//
// 使い方:
//   node scripts/backup-restore-drill.mjs status                  # 現在のbookmarkを確認
//   node scripts/backup-restore-drill.mjs restore --bookmark <id> # 指定bookmarkへ復元（破壊的）
//
// 本番データベースに対する restore は不可逆な操作である。実行前に対象データベース名・
// bookmark・影響範囲を必ず確認すること（Global Autonomous Development Policy §4準拠）。

import { execFileSync } from "node:child_process";

const DB_NAME = process.env.MBAG_D1_NAME ?? "mirai-board-audit-governance-db";
const [, , command, ...rest] = process.argv;

function run(args) {
  console.log(`$ wrangler ${args.join(" ")}`);
  execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
}

const startedAt = Date.now();

switch (command) {
  case "status": {
    run(["d1", "time-travel", "info", DB_NAME]);
    break;
  }
  case "restore": {
    const bookmarkIdx = rest.indexOf("--bookmark");
    const bookmark = bookmarkIdx >= 0 ? rest[bookmarkIdx + 1] : undefined;
    if (!bookmark) {
      console.error("エラー: --bookmark <id> が必要です（wrangler d1 time-travel info で確認）");
      process.exit(1);
    }
    console.log(`[RTO計測開始] ${new Date(startedAt).toISOString()}`);
    run(["d1", "time-travel", "restore", DB_NAME, "--bookmark", bookmark]);
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[RTO計測終了] 所要時間: ${elapsedSeconds}秒（この値をdocs/runbooks/backup-restore.mdへ記録すること）`);
    break;
  }
  default: {
    console.error("使い方: node scripts/backup-restore-drill.mjs <status|restore --bookmark <id>>");
    process.exit(1);
  }
}
