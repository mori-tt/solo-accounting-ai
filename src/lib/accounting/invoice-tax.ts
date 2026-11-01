import {
  computeTaxAmount,
  sumTaxAmounts,
  type ConsumptionTaxRate,
} from "./domain/tax";
import type { Invoice, InvoiceItem } from "./types";

/**
 * 請求書の消費税計算。税額算出は domain/tax のエンジンに委譲し、
 * 画面(フォームの見積表示・一覧の税額表示)と services 層(登録時の
 * 確定値)で同一の計算経路を共有する。
 * 金額は税込(ACCOUNTING_RULES.md: 初期版は税込表示基準)として内税を取り出す。
 */

export const INVOICE_TAX_RATES: readonly ConsumptionTaxRate[] = [
  "standard",
  "reduced",
];

/** 明細に税率が保存されていない場合は標準税率(10%)とみなす(後方互換)。 */
export const DEFAULT_INVOICE_TAX_RATE: ConsumptionTaxRate = "standard";

export function isInvoiceTaxRate(value: unknown): value is ConsumptionTaxRate {
  return (
    typeof value === "string" &&
    (INVOICE_TAX_RATES as readonly string[]).includes(value)
  );
}

/** 明細1行の消費税額(税込金額からの内税・円整数・切り捨て)。 */
export function invoiceItemTaxAmount(
  item: Pick<InvoiceItem, "amount"> & { taxRate?: ConsumptionTaxRate },
): number {
  return computeTaxAmount(item.amount, {
    basis: "inclusive",
    rate: item.taxRate ?? DEFAULT_INVOICE_TAX_RATE,
  });
}

export interface InvoiceTotals {
  /** 請求合計(税込・円整数)= 明細 amount の合計 */
  totalAmount: number;
  /** 合計に含まれる消費税額(明細ごと切り捨ての合算) */
  taxAmount: number;
}

/** 明細配列から請求合計と消費税合計を算出する。 */
export function computeInvoiceTotals(
  items: readonly (Pick<InvoiceItem, "amount"> & {
    taxRate?: ConsumptionTaxRate;
  })[],
): InvoiceTotals {
  let totalAmount = 0;
  for (const item of items) {
    totalAmount += item.amount;
  }
  const taxAmount = sumTaxAmounts(
    items.map((item) => ({
      amount: item.amount,
      basis: "inclusive" as const,
      rate: item.taxRate ?? DEFAULT_INVOICE_TAX_RATE,
    })),
  );
  return { totalAmount, taxAmount };
}

/**
 * 保存済み請求書の消費税額。
 * taxAmount 未保存(税フィールド導入前のデータ)なら明細から導出するため、
 * 旧データでも描画・参照が可能。
 */
export function invoiceTaxAmount(
  invoice: Pick<Invoice, "items" | "taxAmount">,
): number {
  return invoice.taxAmount ?? computeInvoiceTotals(invoice.items).taxAmount;
}
