import { describe, expect, it } from "vitest";
import type { Business, CustomAccount } from "@/lib/accounting/types";
import {
  ACCOUNT_OPTIONS,
  accountLabelIn,
  accountOptionsFor,
  getAccountOptions,
} from "./accounts";

function businessWith(customAccounts?: CustomAccount[]): Business {
  return {
    id: "b1",
    name: "テスト事業",
    ownerUid: "u1",
    fiscalYearStartMonth: 1,
    taxMode: "exempt",
    customAccounts,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };
}

const customExpense: CustomAccount = {
  code: "software_fee",
  label: "ソフトウェア利用料",
  kind: "expense",
};

const customIncome: CustomAccount = {
  code: "consulting",
  label: "コンサルティング収入",
  kind: "income",
};

describe("getAccountOptions", () => {
  it("business未指定・customAccounts空なら標準科目のみ返す", () => {
    expect(getAccountOptions(undefined)).toEqual([...ACCOUNT_OPTIONS]);
    expect(getAccountOptions(null)).toEqual([...ACCOUNT_OPTIONS]);
    expect(getAccountOptions(businessWith())).toEqual([...ACCOUNT_OPTIONS]);
    expect(getAccountOptions(businessWith([]))).toEqual([...ACCOUNT_OPTIONS]);
  });

  it("カスタム科目を標準科目の後ろにマージする", () => {
    const options = getAccountOptions(
      businessWith([customExpense, customIncome]),
    );
    expect(options).toHaveLength(ACCOUNT_OPTIONS.length + 2);
    expect(options.at(-2)).toMatchObject({
      code: "software_fee",
      label: "ソフトウェア利用料",
      kind: "expense",
    });
    expect(options.at(-1)).toMatchObject({ code: "consulting" });
  });

  it("parentCode・disabled を保持する", () => {
    const options = getAccountOptions(
      businessWith([
        { ...customExpense, parentCode: "fees", disabled: true },
      ]),
    );
    const merged = options.find((a) => a.code === "software_fee");
    expect(merged).toMatchObject({
      parentCode: "fees",
      disabled: true,
    });
  });

  it("標準科目と同じコードのカスタム科目は無視する", () => {
    const options = getAccountOptions(
      businessWith([{ ...customExpense, code: "supplies" }]),
    );
    expect(options).toHaveLength(ACCOUNT_OPTIONS.length);
    expect(
      options.find((a) => a.code === "supplies")?.label,
    ).toBe("消耗品費");
  });

  it("カスタム科目同士のコード重複は先勝ちで1件だけにする", () => {
    const options = getAccountOptions(
      businessWith([
        customExpense,
        { ...customExpense, label: "別名" },
      ]),
    );
    expect(
      options.filter((a) => a.code === "software_fee"),
    ).toHaveLength(1);
    expect(
      options.find((a) => a.code === "software_fee")?.label,
    ).toBe("ソフトウェア利用料");
  });
});

describe("accountLabelIn", () => {
  it("マージ済みoptionsからラベルを解決し、未定義コードはそのまま返す", () => {
    const options = getAccountOptions(businessWith([customExpense]));
    expect(accountLabelIn(options, "software_fee")).toBe(
      "ソフトウェア利用料",
    );
    expect(accountLabelIn(options, "supplies")).toBe("消耗品費");
    expect(accountLabelIn(options, "unknown")).toBe("unknown");
  });

  it("無効化された科目もラベル解決できる(既存取引の表示用)", () => {
    const options = getAccountOptions(
      businessWith([{ ...customExpense, disabled: true }]),
    );
    expect(accountLabelIn(options, "software_fee")).toBe(
      "ソフトウェア利用料",
    );
  });
});

describe("accountOptionsFor", () => {
  it("引数省略時は従来どおり標準科目を返す", () => {
    const expense = accountOptionsFor("expense");
    expect(expense.every((a) => a.kind !== "income")).toBe(true);
    const transfer = accountOptionsFor("transfer");
    expect(transfer.every((a) => a.kind === "any")).toBe(true);
  });

  it("マージ済みoptionsを種別で絞り、無効科目を除外する", () => {
    const options = getAccountOptions(
      businessWith([
        customExpense,
        customIncome,
        { code: "old_fee", label: "旧手数料", kind: "expense", disabled: true },
      ]),
    );
    const expense = accountOptionsFor("expense", options);
    expect(expense.map((a) => a.code)).toContain("software_fee");
    expect(expense.map((a) => a.code)).not.toContain("consulting");
    expect(expense.map((a) => a.code)).not.toContain("old_fee");
    const income = accountOptionsFor("income", options);
    expect(income.map((a) => a.code)).toContain("consulting");
    expect(income.map((a) => a.code)).not.toContain("software_fee");
  });
});
