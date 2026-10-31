import { buildAuditEntry } from "../audit";
import { isWithinPeriod } from "../dates";
import { DomainError } from "../errors";
import type { AccountingReader } from "../store/types";
import { docPath } from "../store/types";
import type {
  AuditAction,
  AuditLogEntry,
  FiscalPeriod,
  Transaction,
} from "../types";

/** コマンド実行者。uid は監査ログと createdBy に記録される。 */
export interface ActorContext {
  uid: string;
  /** ISO 8601。省略時は呼び出し時刻 */
  at?: string;
}

export function nowOf(actor: ActorContext): string {
  return actor.at ?? new Date().toISOString();
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * puts の各ドキュメントに対応する監査ログを生成する。
 * 監査ログには識別情報のみ記録し、ドキュメント内容は含めない。
 */
export function auditsFor(
  businessId: string,
  puts: readonly { collection: string; id: string }[],
  action: AuditAction,
  actor: ActorContext,
  makeId: () => string = newId,
): AuditLogEntry[] {
  return puts.map((put) =>
    buildAuditEntry({
      id: makeId(),
      actorUid: actor.uid,
      action,
      targetPath: docPath(businessId, put.collection as never, put.id),
      at: nowOf(actor),
    }),
  );
}

/** 指定日付が締め済み期間に含まれる場合は PERIOD_CLOSED を投げる。 */
export function assertDateInOpenPeriod(
  date: string,
  periods: readonly FiscalPeriod[],
): void {
  for (const period of periods) {
    if (
      period.status === "closed" &&
      isWithinPeriod(date, period.startDate, period.endDate)
    ) {
      throw new DomainError(
        "PERIOD_CLOSED",
        `date ${date} belongs to closed fiscal period ${period.id}`,
        { periodId: period.id },
      );
    }
  }
}

export async function assertDateOpen(
  reader: AccountingReader,
  businessId: string,
  date: string,
): Promise<void> {
  const periods = await reader.listFiscalPeriods(businessId);
  assertDateInOpenPeriod(date, periods);
}

/** 締め済み(locked)のTransactionへの直接変更を防ぐ。 */
export function assertTransactionMutable(transaction: Transaction): void {
  if (transaction.status === "locked") {
    throw new DomainError(
      "PERIOD_CLOSED",
      `transaction ${transaction.id} is locked`,
      { transactionId: transaction.id },
    );
  }
}

/**
 * Transactionへの変更可否。locked 判定に加えて、
 * 取引日が締め済み期間に含まれないことも確認する。
 */
export async function assertTransactionEditable(
  reader: AccountingReader,
  businessId: string,
  transaction: Transaction,
): Promise<void> {
  assertTransactionMutable(transaction);
  const periods = await reader.listFiscalPeriods(businessId);
  assertDateInOpenPeriod(transaction.date, periods);
}
