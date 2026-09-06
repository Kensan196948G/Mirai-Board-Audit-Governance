# バックログ（MVP対象外）

| ID | 項目 | 優先度 | 受入条件 | 備考 |
|---|---|---|---|---|
| B-01 | ライセンス設定 | P1 | 権利者がライセンス種別を決定し LICENSE を配置 | package.json には `"license": "UNLICENSED"` を明示（未選択の明示）。種別決定は権利者判断 |
| B-02 | OIDC/SSO + MFA 本実装 | P1 | 実IdP連携、MFA、失効処理のE2E合格 | 🟡 抽象化層・PKCE・JWKS署名検証（RS256、iss/aud/exp/nonce/email_verified検証、外部fetchはタイムアウト付き）・ログイン試行の実装済み（`src/auth-providers/oidc.ts`, `src/routes/oidc.ts`）。`OIDC_ISSUER`等が未設定の間は`/api/auth/oidc/*`が501を返し、既存のデモログインには影響しない。**既知の制約**: メールアドレスはIDトークンのクレームのみで取得し、UserInfoエンドポイントへのフォールバックは未実装（ID tokenにemailを含めないIdP構成では要追加対応）。**実IdPのテナント情報・クライアントシークレットの提供が必要**（MFA可否はIdP側ポリシーに依存） |
| B-03 | 実メール通知・再送・DLQ | P1 | 送信成功/失敗/再送/受領が実環境で確認 | 🟡 `EmailProvider`抽象化・`notification_deliveries`（配送記録・再送・DLQ）を実装済み（`src/services/email/`, `src/services/notify.ts`）。既定は`console`（外部送信なし）。**実プロバイダのWebhook URL・署名鍵の提供が必要**（`EMAIL_PROVIDER=webhook`） |
| B-04 | 正本外部連携（文書管理・人事等） | P2 | REST/OIDC、Webhook署名、差分照合 | 🟡 `ExternalConnector`抽象化・HMAC-SHA256署名検証（送受信双方向・タイムアウト付き）・受信イベント台帳を実装済み（`src/services/connectors/`, `src/routes/connectors.ts`）。既定は未設定＝送受信とも無効。**実システムのWebhook URL・共有鍵の提供が必要** |
| B-05 | PDF帳票（サーバ生成） | P2 | 証拠パッケージ・議事録のPDF生成 | 🟡 実装済み（依存パッケージ無しの自前PDF生成 `src/pdf.ts`）。証拠パッケージ・議事録・廃棄証明書をPDFで取得可能（印刷用HTMLと併存）。**既知の制約**: 単純フォント（Courier）のみのためASCII/Latin-1以外（日本語含む）は文字化けの可能性あり。日本語コンテンツは当面、印刷用HTML（ブラウザ印刷→PDF）を推奨。CJK対応にはCIDフォント埋め込みが必要（別途対応） |
| B-06 | 性能・負荷試験（100同時、p95） | P2 | NFR-02基準達成 | 🟡 k6スクリプト・手動起動ワークフローを整備済み（`scripts/load/k6-smoke.js`, `.github/workflows/load-test.yml`）。ログインとdashboardのレイテンシー集計を分離（`endpoint:auth`/`endpoint:general`）。**本番/Preview相当環境での実施・結果記録が未了** |
| B-07 | SAST/DAST/依存性スキャン | P2 | 高リスク0件 | 🟡 CIへ組み込み済み（`npm audit --audit-level=high`、Dependency Review、CodeQL）。リポジトリはpublicのためCodeQLはGHAS無しで動作（PR #23で確認済み）。**Dependency Reviewは"Dependency graph"が未有効化のため失敗中**（必須チェックではないためマージはブロックされない。Settings→Code security and analysisで有効化が必要） |
| B-08 | バックアップ・復元試験 / RPO・RTO測定 | P2 | D1 Time Travel検証、復元手順書 | 🟡 手順書・実行スクリプトを整備済み（`docs/runbooks/backup-restore.md`, `scripts/backup-restore-drill.mjs`）。プラン別保持期間（Free 7日/Paid 30日）とストレージバージョン確認手順を明記。**本番D1環境での初回訓練・RPO/RTO記録が未実施** |
| B-09 | 四半期アクセス再認証・緊急権限の自動失効 | P2 | 期限切れ強制のE2E | ✅ 実装済み。`access_certifications`/`emergency_access_grants`テーブル、Cron Trigger（日次）による自動失効（原子的なUPDATEで競合時の誤失効・二重処理を防止）、`requirePerm`が緊急権限を実際の認可判定に反映、統合テストで期限切れ強制・認可反映を検証済み |
| B-10 | 実AI（LLM）草案・RAG | P3 | 出典到達性、人レビュー、誤回答ガード | 現状は規則ベースのデモ。**外部LLM APIキーの提供が必要**（未着手） |
| B-11 | 全FR-01〜15の完全実装（通知高度化・廃棄証明書等） | P3 | 詳細仕様の受入基準 | ✅ 通知エスカレーション記録・廃棄証明書PDFを実装済み |
| B-12 | UAT・教育・並行運用手順 | P3 | 限定導入判定 | 本番フェーズ（人的プロセスのためコード実装対象外） |
| B-13 | ~~MVP用サブドメイン設定~~ | P3 | ✅ 実装済み（2026-08-14） | `mbag-mvp.mirai-dx-platform.com` をCloudflare Tunnelで公開（Workers Preview配信）。CNAME・トンネルingress・`httpHostHeader` 設定を適用し、SPA/ログイン/データの動作確認済み |

## 記録

- 2026-08-12: 初版作成。MVP完了後に本ファイルへ追加・更新する。
- 2026-08-14: B-01 に package.json の `"license": "UNLICENSED"` 明示を反映。B-13（MVP用サブドメイン）を追加。
- 2026-08-14: B-13 を実装済みに更新（`mbag-mvp.mirai-dx-platform.com` 公開）。
- 2026-09-06: B-05/B-09/B-11 を実装完了。B-02/B-03/B-04/B-06/B-07/B-08 はコード・スタブ・CI組み込みまで実装し、外部サービスの接続情報（IdP・メールプロバイダ・Webhook先・本番環境での実施）待ちの状態に前進（ブランチ `feat/backlog-governance-hardening`）。
