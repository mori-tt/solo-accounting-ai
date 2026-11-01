"use client";

import { createPortal } from "react-dom";
import {
  DEFAULT_INVOICE_TAX_RATE,
  INVOICE_TAX_RATES,
  invoiceItemTaxAmount,
} from "@/lib/accounting/invoice-tax";
import type { ConsumptionTaxRate } from "@/lib/accounting/domain/tax";
import type { Customer, Invoice } from "@/lib/accounting/types";
import { formatDateJP, formatYen } from "@/lib/format";

/** 税率区分の表示名。明細行の税率列・税率別内訳表で共用する。 */
const RATE_NAMES: Record<ConsumptionTaxRate, string> = {
  standard: "10%",
  reduced: "8%",
};

const RATE_GROUP_NAMES: Record<ConsumptionTaxRate, string> = {
  standard: "10%対象",
  reduced: "8%対象(軽減税率)",
};

export interface InvoiceRateGroup {
  rate: ConsumptionTaxRate;
  /** 対価の額(税込・円整数) */
  amount: number;
  /** 消費税額(円整数・明細ごと切り捨ての合算) */
  taxAmount: number;
}

/**
 * 明細を税率ごとに集計する。消費税額は明細行ごとの内税を
 * 合算する(invoice.taxAmount の算出と同じ経路)。
 */
export function groupInvoiceItemsByRate(invoice: Invoice): InvoiceRateGroup[] {
  const groups = new Map<ConsumptionTaxRate, InvoiceRateGroup>();
  for (const item of invoice.items) {
    const rate = item.taxRate ?? DEFAULT_INVOICE_TAX_RATE;
    const group = groups.get(rate) ?? { rate, amount: 0, taxAmount: 0 };
    group.amount += item.amount;
    group.taxAmount += item.taxAmount ?? invoiceItemTaxAmount(item);
    groups.set(rate, group);
  }
  return INVOICE_TAX_RATES.map((rate) => groups.get(rate)).filter(
    (group): group is InvoiceRateGroup => group !== undefined,
  );
}

/**
 * 請求書の印刷用単票ビュー。document.body 直下に portal するため、
 * globals.css の @media print で画面側のUIを隠せばこの要素だけが印刷される。
 * 印刷物の配色は常に白地・黒字固定(dark: 系のユーティリティを使わない)。
 */
export function InvoicePrintSheet({
  invoice,
  customer,
  projectName,
  businessName,
}: {
  invoice: Invoice;
  customer?: Customer;
  projectName?: string;
  businessName?: string;
}) {
  const rateGroups = groupInvoiceItemsByRate(invoice);
  const taxTotal = rateGroups.reduce((sum, g) => sum + g.taxAmount, 0);
  const hasReduced = rateGroups.some((g) => g.rate === "reduced");

  return createPortal(
    <div className="invoice-print-area">
      <div className="ip-sheet">
        <h1 className="ip-title">
          請求書
          {invoice.status === "draft" && (
            <span className="ip-draft-mark">(下書き)</span>
          )}
        </h1>

        <div className="ip-head">
          <div className="ip-recipient">
            <p className="ip-recipient-name">{customer?.name ?? "-"} 御中</p>
            {customer?.address && (
              <p className="ip-recipient-address">{customer.address}</p>
            )}
            {projectName && (
              <p className="ip-recipient-project">案件: {projectName}</p>
            )}
            <p className="ip-greeting">下記のとおりご請求申し上げます。</p>
          </div>
          <div className="ip-meta">
            <table className="ip-meta-table">
              <tbody>
                <tr>
                  <th>請求番号</th>
                  <td>{invoice.id}</td>
                </tr>
                <tr>
                  <th>発行日</th>
                  <td>{formatDateJP(invoice.issueDate)}</td>
                </tr>
                <tr>
                  <th>支払期限</th>
                  <td>{formatDateJP(invoice.dueDate)}</td>
                </tr>
              </tbody>
            </table>
            <div className="ip-issuer">
              <p className="ip-issuer-name">{businessName ?? ""}</p>
              <p className="ip-issuer-reg">
                登録番号: T<span className="ip-blank ip-blank-reg" />
              </p>
            </div>
          </div>
        </div>

        <div className="ip-total-box">
          <span>ご請求金額(税込)</span>
          <span className="ip-total-amount">
            {formatYen(invoice.totalAmount)}
          </span>
        </div>

        <table className="ip-table">
          <thead>
            <tr>
              <th className="ip-col-desc">品目</th>
              <th className="ip-num">数量</th>
              <th className="ip-num">単価(税込)</th>
              <th>税率</th>
              <th className="ip-num">金額(税込)</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, idx) => {
              const rate = item.taxRate ?? DEFAULT_INVOICE_TAX_RATE;
              return (
                <tr key={idx}>
                  <td>{item.description || "-"}</td>
                  <td className="ip-num">{item.quantity}</td>
                  <td className="ip-num">{formatYen(item.unitPrice)}</td>
                  <td>
                    {RATE_NAMES[rate]}
                    {rate === "reduced" && "※"}
                  </td>
                  <td className="ip-num">{formatYen(item.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasReduced && (
          <p className="ip-note">※印は軽減税率(8%)の適用対象です。</p>
        )}

        <div className="ip-break">
          <table className="ip-table ip-breakdown">
            <thead>
              <tr>
                <th>税率区分</th>
                <th className="ip-num">対価の額(税込)</th>
                <th className="ip-num">消費税額</th>
              </tr>
            </thead>
            <tbody>
              {rateGroups.map((group) => (
                <tr key={group.rate}>
                  <td>{RATE_GROUP_NAMES[group.rate]}</td>
                  <td className="ip-num">{formatYen(group.amount)}</td>
                  <td className="ip-num">{formatYen(group.taxAmount)}</td>
                </tr>
              ))}
              <tr className="ip-breakdown-total">
                <td>合計</td>
                <td className="ip-num">{formatYen(invoice.totalAmount)}</td>
                <td className="ip-num">{formatYen(taxTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="ip-foot">
          <div className="ip-bank">
            <p className="ip-section-title">振込先</p>
            <div className="ip-bank-box">
              <div className="ip-bank-row">
                <span className="ip-bank-label">金融機関名</span>
                <span className="ip-blank" />
                <span className="ip-bank-label">支店名</span>
                <span className="ip-blank" />
              </div>
              <div className="ip-bank-row">
                <span className="ip-bank-label">口座種別</span>
                <span className="ip-blank" />
                <span className="ip-bank-label">口座番号</span>
                <span className="ip-blank" />
              </div>
              <div className="ip-bank-row">
                <span className="ip-bank-label">口座名義</span>
                <span className="ip-blank ip-blank-wide" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
