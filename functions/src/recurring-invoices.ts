import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { monthKeyOf } from "../../src/lib/accounting/dates";
import { generateRecurringInvoices } from "../../src/lib/accounting/services/recurring-invoices";
import { FirestoreAccountingStore } from "../../src/lib/accounting/store/firestore";
import { adminDb } from "./admin";
import { errorMessage } from "./backup-utils";
import { SCHEDULE_TIME_ZONE, todayInTimeZone } from "./time";

/**
 * 監査ログ・createdBy に記録するスケジューラ実行のactor識別子。
 * 実在ユーザーのuidを偽装しない(closingChecks のサーバー生成時
 * "system" と同じ規約)。
 */
const SCHEDULER_ACTOR = "system";

/**
 * 定期請求書の自動生成(毎日 03:00 JST)。
 *
 * 全事業の recurringInvoiceTemplates について、当月(yyyyMM)の
 * 期日到来分をドラフト請求書(status=draft)として生成する。
 * 生成ロジックはアプリの手動実行「今月分を生成」と同一のドメイン層
 * (src/lib/accounting/services/recurring-invoices.ts)を使い、
 * - lastGeneratedMonth による月1回の生成管理
 * - 決定的ID recurring-invoice-{templateId}-{yyyyMM} による二重生成防止
 * - invoiceCounter からの請求書番号採番・監査ログ記録・締め済み期間ガード
 * がそのまま効くため、日次実行は冪等(翌日実行がリトライを兼ねる)。
 * 1事業の失敗(締め済み期間への発行日等)は他事業へ波及させず、
 * 構造化ログに記録して継続する。
 */
export const generateRecurringInvoicesDaily = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: SCHEDULE_TIME_ZONE,
    region: "asia-northeast1",
    timeoutSeconds: 540,
  },
  async () => {
    const db = adminDb();
    const store = new FirestoreAccountingStore(db);
    const monthKey = monthKeyOf(todayInTimeZone());
    const businesses = await db.collection("businesses").listDocuments();

    let created = 0;
    let failed = 0;
    for (const ref of businesses) {
      try {
        const { invoices } = await generateRecurringInvoices(
          store,
          ref.id,
          { uid: SCHEDULER_ACTOR },
          monthKey,
        );
        created += invoices.length;
      } catch (e) {
        failed += 1;
        logger.error("定期請求書の生成に失敗", {
          businessId: ref.id,
          monthKey,
          error: errorMessage(e),
        });
      }
    }
    logger.info("定期請求書の日次生成が完了", {
      monthKey,
      businesses: businesses.length,
      created,
      failed,
    });
  },
);
