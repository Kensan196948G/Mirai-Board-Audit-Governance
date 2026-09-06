/** バックログ B-04: 正本外部連携（文書管理・人事等）のコネクタ抽象化 */

export type ConnectorSyncEvent = {
  recordType: string;
  recordId: string;
  action: string;
  payload: Record<string, unknown>;
};

export type ConnectorSyncResult = {
  ok: boolean;
  error?: string;
};

export interface ExternalConnector {
  readonly name: string;
  readonly configured: boolean;
  /** 正本システムへ変更を通知する（実接続先は環境変数で設定するまで no-op） */
  syncOutbound(event: ConnectorSyncEvent): Promise<ConnectorSyncResult>;
}
