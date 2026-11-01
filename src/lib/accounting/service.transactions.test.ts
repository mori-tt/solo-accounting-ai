import { describe, expect, it } from "vitest";
import {
  ACTOR,
  BIZ,
  expectDomainError,
  setup,
} from "./test-helpers";
import type { TransactionInput } from "./domain/validate";

function input(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    type: "income",
    date: "2026-10-15",
    amount: 100_000,
    account: "sales",
    counterparty: "client-a",
    description: "october work",
    ...overrides,
  };
}

describe("registerTransaction", () => {
  it("取引をdraftとして登録し監査ログを残す", async () => {
    const { service } = setup();
    const { transaction, deduplicated } = await service.registerTransaction(
      BIZ,
      input(),
      ACTOR,
    );
    expect(deduplicated).toBe(false);
    expect(transaction).toMatchObject({
      type: "income",
      date: "2026-10-15",
      amount: 100_000,
      status: "draft",
      aiSuggestion: null,
      createdBy: ACTOR,
    });

    const logs = await service.listAuditLogs(BIZ);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorUid: ACTOR,
      action: "create",
      targetPath: `businesses/${BIZ}/transactions/${transaction.id}`,
    });
  });

  it("金額0円を拒否する", async () => {
    const { service } = setup();
    await expectDomainError(
      service.registerTransaction(BIZ, input({ amount: 0 }), ACTOR),
      "INVALID_AMOUNT",
    );
  });

  it("負の金額を拒否する", async () => {
    const { service } = setup();
    await expectDomainError(
      service.registerTransaction(BIZ, input({ amount: -50_000 }), ACTOR),
      "INVALID_AMOUNT",
    );
  });

  it("小数・非整数の金額を拒否する", async () => {
    const { service } = setup();
    await expectDomainError(
      service.registerTransaction(BIZ, input({ amount: 100.5 }), ACTOR),
      "INVALID_AMOUNT",
    );
    await expectDomainError(
      service.registerTransaction(BIZ, input({ amount: NaN }), ACTOR),
      "INVALID_AMOUNT",
    );
  });

  it("存在しない日付・不正形式を拒否する", async () => {
    const { service } = setup();
    await expectDomainError(
      service.registerTransaction(BIZ, input({ date: "2026-13-01" }), ACTOR),
      "INVALID_DATE",
    );
    await expectDomainError(
      service.registerTransaction(BIZ, input({ date: "2026-02-30" }), ACTOR),
      "INVALID_DATE",
    );
  });

  it("冪等キーが同じ再送は二重登録しない", async () => {
    const { service, store } = setup();
    const first = await service.registerTransaction(
      BIZ,
      { ...input(), idempotencyKey: "key-1" },
      ACTOR,
    );
    const second = await service.registerTransaction(
      BIZ,
      { ...input(), idempotencyKey: "key-1" },
      ACTOR,
    );
    expect(second.deduplicated).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(await store.list(BIZ, "transactions")).toHaveLength(1);
    expect(await service.listAuditLogs(BIZ)).toHaveLength(1);
  });

  it("冪等キーが異なれば別取引として登録する", async () => {
    const { service, store } = setup();
    await service.registerTransaction(
      BIZ,
      { ...input(), idempotencyKey: "key-1" },
      ACTOR,
    );
    await service.registerTransaction(
      BIZ,
      { ...input(), idempotencyKey: "key-2" },
      ACTOR,
    );
    expect(await store.list(BIZ, "transactions")).toHaveLength(2);
  });
});

describe("updateTransaction", () => {
  it("科目や金額を更新し監査ログを残す", async () => {
    const { service } = setup();
    const { transaction } = await service.registerTransaction(
      BIZ,
      input(),
      ACTOR,
    );
    const updated = await service.updateTransaction(
      BIZ,
      transaction.id,
      { account: "consulting", amount: 120_000 },
      ACTOR,
    );
    expect(updated.account).toBe("consulting");
    expect(updated.amount).toBe(120_000);
    const actions = (await service.listAuditLogs(BIZ)).map((l) => l.action);
    expect(actions).toEqual(["create", "update"]);
  });

  it("不正な更新内容を拒否する", async () => {
    const { service } = setup();
    const { transaction } = await service.registerTransaction(
      BIZ,
      input(),
      ACTOR,
    );
    await expectDomainError(
      service.updateTransaction(BIZ, transaction.id, { amount: 0 }, ACTOR),
      "INVALID_AMOUNT",
    );
  });
});

describe("confirmTransaction", () => {
  it("draftをconfirmedにする", async () => {
    const { service } = setup();
    const { transaction } = await service.registerTransaction(
      BIZ,
      input(),
      ACTOR,
    );
    const confirmed = await service.confirmTransaction(
      BIZ,
      transaction.id,
      ACTOR,
    );
    expect(confirmed.status).toBe("confirmed");
  });

  it("confirmed済みの再確定を拒否する", async () => {
    const { service } = setup();
    const { transaction } = await service.registerTransaction(
      BIZ,
      input(),
      ACTOR,
    );
    await service.confirmTransaction(BIZ, transaction.id, ACTOR);
    await expectDomainError(
      service.confirmTransaction(BIZ, transaction.id, ACTOR),
      "INVALID_STATE",
    );
  });
});

describe("deleteTransaction", () => {
  it("取引を削除し監査ログを残す", async () => {
    const { service, store } = setup();
    const { transaction } = await service.registerTransaction(
      BIZ,
      input(),
      ACTOR,
    );
    await service.deleteTransaction(BIZ, transaction.id, ACTOR);
    expect(await store.list(BIZ, "transactions")).toHaveLength(0);
    expect(
      (await service.listAuditLogs(BIZ)).map((l) => l.action),
    ).toContain("delete");
  });

  it("経費レコード付き取引の削除は経費も削除する", async () => {
    const { service, store } = setup();
    const { transaction } = await service.registerExpense(
      BIZ,
      {
        type: "expense",
        date: "2026-10-15",
        amount: 8_000,
        account: "supplies",
        counterparty: "store",
        description: "tools",
        taxCategory: "taxable",
        taxAmount: 800,
      },
      ACTOR,
    );
    await service.deleteTransaction(BIZ, transaction.id, ACTOR);
    expect(await store.list(BIZ, "transactions")).toHaveLength(0);
    expect(await store.list(BIZ, "expenses")).toHaveLength(0);
  });

  it("経費レコード付き取引のtype変更を拒否する", async () => {
    const { service } = setup();
    const { transaction } = await service.registerExpense(
      BIZ,
      {
        type: "expense",
        date: "2026-10-15",
        amount: 8_000,
        account: "supplies",
        counterparty: "store",
        description: "tools",
        taxCategory: "taxable",
        taxAmount: 800,
      },
      ACTOR,
    );
    await expectDomainError(
      service.updateTransaction(BIZ, transaction.id, { type: "income" }, ACTOR),
      "INVALID_STATE",
    );
  });
});

describe("findDuplicatesFor", () => {
  it("同日・同額の既存取引を候補に挙げる", async () => {
    const { service } = setup();
    const first = await service.registerTransaction(BIZ, input(), ACTOR);
    const second = await service.registerTransaction(BIZ, input(), ACTOR);
    const candidates = await service.findDuplicatesFor(BIZ, second.transaction.id);
    expect(candidates.map((c) => c.transaction.id)).toEqual([
      first.transaction.id,
    ]);
  });
});
