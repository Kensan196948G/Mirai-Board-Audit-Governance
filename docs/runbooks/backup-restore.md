# バックアップ・復元手順（D1 Time Travel）— バックログ B-08

## 前提

- Cloudflare D1 の Time Travel は **Workers Paid プランで30日、Free プランで7日** の保持期間。
- Time Travel が使えるのは `wrangler d1 info <db-name>` で `version: production` と表示されるDBのみ。
  `version: alpha` の場合は本手順ではなく旧世代のスナップショットAPIでの復元が必要（別途確認）。
- 追加のバックアップジョブ設定は不要（D1がWAL単位で自動的に保持）。
- 実行には Cloudflare 認証（`wrangler login` 済み、または `CLOUDFLARE_API_TOKEN`）が必要。

## 手順

1. 対象DBのプラン・バージョンを確認する。
   ```bash
   npx wrangler d1 info mirai-board-audit-governance-db
   ```
2. 現在の bookmark を確認する。
   ```bash
   node scripts/backup-restore-drill.mjs status
   ```
3. 復元対象の bookmark（時刻またはID）を選定する。
4. 復元を実行する（**不可逆操作**。対象データベース名・bookmark・影響範囲を確認の上、実行前に承認を得ること）。
   対象データベース名は既定値に依存せず必ず明示する。
   ```bash
   MBAG_D1_NAME=mirai-board-audit-governance-db node scripts/backup-restore-drill.mjs restore --bookmark <bookmark-id>
   ```
5. 復元後、以下を確認する。
   - `GET /api/health` が 200 を返す
   - `GET /api/audit-events/verify-chain` が `valid: true` を返す（監査ログチェーンの整合性）
   - 主要画面（議案・監査調書・ダッシュボード）が表示できる

## RPO / RTO 計測記録

| 実施日 | bookmark | RTO（復元所要時間） | RPO（データ損失時間の見積り） | 実施者 | 備考 |
|---|---|---|---|---|---|
| （未実施） | - | - | - | - | 本番D1環境での初回訓練が必要 |

## 注意

- 本番環境での復元訓練は、影響範囲（同時利用者・進行中の議決/監査プロセス）を確認し、
  Global Autonomous Development Policy §4（本番デプロイ方針）に従って実施すること。
- ローカル/Preview環境での訓練は自由に実施してよい。
