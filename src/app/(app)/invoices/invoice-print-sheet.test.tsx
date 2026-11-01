import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Invoice } from "@/lib/accounting/types";
import {
  groupInvoiceItemsByRate,
  InvoicePrintSheet,
} from "./invoice-print-sheet";

afterEach(cleanup);

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-2026-001",
    customerId: "cust-1",
    issueDate: "2026-10-15",
    dueDate: "2026-11-30",
    items: [
      {
        description: "デザイン制作費",
        quantity: 1,
        unitPrice: 11000,
        amount: 11000,
        taxRate: "standard",
        taxAmount: 1000,
      },
      {
        description: "印刷代",
        quantity: 2,
        unitPrice: 540,
        amount: 1080,
        taxRate: "reduced",
        taxAmount: 80,
      },
    ],
    totalAmount: 12080,
    taxAmount: 1080,
    status: "issued",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("groupInvoiceItemsByRate", () => {
  it("税率ごとの対価・消費税額を standard→reduced 順で返す", () => {
    const groups = groupInvoiceItemsByRate(makeInvoice());
    expect(groups).toEqual([
      { rate: "standard", amount: 11000, taxAmount: 1000 },
      { rate: "reduced", amount: 1080, taxAmount: 80 },
    ]);
  });

  it("taxRate/taxAmount 未保存の明細は標準税率で内税を算出する", () => {
    const groups = groupInvoiceItemsByRate(
      makeInvoice({
        items: [
          { description: "旧明細", quantity: 1, unitPrice: 11000, amount: 11000 },
        ],
        taxAmount: undefined,
      }),
    );
    expect(groups).toEqual([
      { rate: "standard", amount: 11000, taxAmount: 1000 },
    ]);
  });
});

describe("InvoicePrintSheet", () => {
  it("宛名・番号・日付・発行元・登録番号欄・振込先欄を出力する", () => {
    render(
      <InvoicePrintSheet
        invoice={makeInvoice()}
        customer={{ id: "cust-1", name: "株式会社テスト", createdAt: "" }}
        businessName="テスト商店"
      />,
    );

    expect(screen.getByText("株式会社テスト 御中")).toBeTruthy();
    expect(screen.getByText("inv-2026-001")).toBeTruthy();
    expect(screen.getByText("2026年10月15日")).toBeTruthy();
    expect(screen.getByText("2026年11月30日")).toBeTruthy();
    expect(screen.getByText("テスト商店")).toBeTruthy();
    expect(screen.getByText(/^登録番号/)).toBeTruthy();
    expect(screen.getByText("振込先")).toBeTruthy();
  });

  it("税率別内訳(対価の額・消費税額)と軽減税率の※注記を出力する", () => {
    render(<InvoicePrintSheet invoice={makeInvoice()} />);

    expect(screen.getByText("10%対象")).toBeTruthy();
    expect(screen.getByText("8%対象(軽減税率)")).toBeTruthy();
    expect(screen.getByText("対価の額(税込)")).toBeTruthy();
    expect(screen.getByText("消費税額")).toBeTruthy();
    expect(screen.getByText("※印は軽減税率(8%)の適用対象です。")).toBeTruthy();
    // 明細行の軽減税率セルに※印
    expect(screen.getByText("8%※")).toBeTruthy();
  });

  it("標準税率のみの請求書では※注記を出さない", () => {
    render(
      <InvoicePrintSheet
        invoice={makeInvoice({
          items: [
            {
              description: "デザイン制作費",
              quantity: 1,
              unitPrice: 11000,
              amount: 11000,
              taxRate: "standard",
              taxAmount: 1000,
            },
          ],
          totalAmount: 11000,
          taxAmount: 1000,
        })}
      />,
    );

    expect(
      screen.queryByText("※印は軽減税率(8%)の適用対象です。"),
    ).toBeNull();
  });
});
