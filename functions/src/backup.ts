import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  backupFreshness,
  exportBusinessBackup,
} from "../../src/lib/backup-export";
import { adminBucket, adminDb } from "./admin";
import { backupObjectPath, errorMessage, lastBackupIso } from "./backup-utils";
import { SCHEDULE_TIME_ZONE, todayInTimeZone } from "./time";

/**
 * スケジュールバックアップ基盤(毎日 04:00 JST)。
 *
 * 各事業の businesses/{id}.lastBackupAt を確認し、
 * 鮮度が fresh(30日以内・アプリのダッシュボード警告と同じ閾値)で
 * ない事業だけバックアップJSONを Cloud Storage へ出力する。
 * - 出力先: backups/{businessId}/backup-{YYYY-MM-DD}.json
 *   (storage.rules が許可する receipts/ とは別領域=クライアント非公開)
 * - 成功時は lastBackupAt を更新し、ダッシュボードの鮮度アラートと
 *   同じ「最終バックアップ」 semantics を維持する
 * - stale/never の検出は logger.warn に構造化して残す。
 *   通知配送(メール等)は未実装で、このログが監視アラートの
 *   フック点(リマインダ基盤)となる
 * - 保存ファイルの世代管理(古いバックアップ削除)はバケットの
 *   ライフサイクル設定で行う運用を想定(コード側では削除しない)
 * 1事業の失敗は他事業へ波及させない。
 */
export const exportStaleBackupsDaily = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: SCHEDULE_TIME_ZONE,
    region: "asia-northeast1",
    timeoutSeconds: 540,
  },
  async () => {
    const db = adminDb();
    const bucket = adminBucket();
    const today = todayInTimeZone();
    const businesses = await db.collection("businesses").listDocuments();

    let exported = 0;
    let skipped = 0;
    let failed = 0;
    for (const ref of businesses) {
      try {
        const snap = await ref.get();
        const lastBackupAt = lastBackupIso(snap.data());
        const freshness = backupFreshness(lastBackupAt);
        if (freshness === "fresh") {
          skipped += 1;
          continue;
        }
        logger.warn("バックアップ鮮度の劣化を検出", {
          businessId: ref.id,
          freshness,
          lastBackupAt: lastBackupAt ?? null,
        });
        const backup = await exportBusinessBackup(db, ref.id);
        await bucket
          .file(backupObjectPath(ref.id, today))
          .save(JSON.stringify(backup), {
            contentType: "application/json; charset=utf-8",
          });
        await ref.update({ lastBackupAt: FieldValue.serverTimestamp() });
        exported += 1;
      } catch (e) {
        failed += 1;
        logger.error("バックアップのエクスポートに失敗", {
          businessId: ref.id,
          error: errorMessage(e),
        });
      }
    }
    logger.info("スケジュールバックアップが完了", {
      businesses: businesses.length,
      exported,
      skipped,
      failed,
    });
  },
);
