"use server";

import { auditsFor } from "@/lib/accounting/services/common";
import type { Business, CustomAccount } from "@/lib/accounting/types";
import { ACCOUNT_OPTIONS } from "@/lib/accounts";
import { ApiError, fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  customAccountsSchema,
  parseForm,
  type CustomAccountInput,
} from "@/lib/validation/schemas";

const builtInCodes = new Set(ACCOUNT_OPTIONS.map((a) => a.code));

/** 取引で使用されている科目コード一覧(削除可否の判定用) */
export async function listUsedAccountCodes(
  businessId: string,
): Promise<ActionResult<string[]>> {
  return run(async () => {
    await requireViewer(businessId);
    const transactions = await getStore().listTransactionsInRange(
      businessId,
      "0001-01-01",
      "9999-12-31",
    );
    return [...new Set(transactions.map((t) => t.account))];
  });
}

/**
 * カスタム科目一覧を丸ごと保存する(businessドキュメント内・最大50件)。
 * - code は事業内一意・英数字、かつ標準科目と重複不可
 * - parentCode は標準科目または一覧内の他カスタム科目のみ指定可
 * - 取引で使用中の科目の削除は不可(無効化で代替)
 */
export async function saveCustomAccounts(
  businessId: string,
  accounts: CustomAccountInput[],
): Promise<ActionResult<Business>> {
  const parsed = parseForm(customAccountsSchema, accounts);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  const list = parsed.data;

  const seen = new Set<string>();
  for (const a of list) {
    if (builtInCodes.has(a.code)) {
      return fail(
        "INVALID_INPUT",
        `科目コード「${a.code}」は標準科目と重複しています`,
      );
    }
    if (seen.has(a.code)) {
      return fail("INVALID_INPUT", `科目コード「${a.code}」が重複しています`);
    }
    seen.add(a.code);
  }
  for (const a of list) {
    if (!a.parentCode) continue;
    if (a.parentCode === a.code) {
      return fail(
        "INVALID_INPUT",
        `科目「${a.code}」の親科目に自分自身は指定できません`,
      );
    }
    if (!builtInCodes.has(a.parentCode) && !seen.has(a.parentCode)) {
      return fail(
        "INVALID_INPUT",
        `科目「${a.code}」の親科目「${a.parentCode}」が存在しません`,
      );
    }
  }

  return run(async () => {
    const actor = await requireEditor(businessId);
    const store = getStore();
    const { value } = await store.transact(businessId, {}, async (tx) => {
      const current = await tx.getBusiness(businessId);
      if (!current) {
        throw new ApiError("NOT_FOUND", "事業が見つかりません");
      }
      const nextCodes = new Set(list.map((a) => a.code));
      const removed = (current.customAccounts ?? []).filter(
        (c) => !nextCodes.has(c.code),
      );
      if (removed.length > 0) {
        const transactions = await tx.listTransactionsInRange(
          businessId,
          "0001-01-01",
          "9999-12-31",
        );
        const used = new Set(transactions.map((t) => t.account));
        const blocked = removed.filter((c) => used.has(c.code));
        if (blocked.length > 0) {
          throw new ApiError(
            "INVALID_INPUT",
            `取引で使用中の科目は削除できません。無効化してください: ${blocked
              .map((c) => c.code)
              .join(", ")}`,
          );
        }
      }
      const next: Business = {
        ...current,
        customAccounts: list.map(
          (a): CustomAccount => ({
            code: a.code,
            label: a.label,
            kind: a.kind,
            ...(a.parentCode ? { parentCode: a.parentCode } : {}),
            ...(a.disabled ? { disabled: true } : {}),
          }),
        ),
        updatedAt: new Date().toISOString(),
      };
      return {
        batch: {
          puts: [
            {
              collection: "businesses" as const,
              id: businessId,
              data: next,
            },
          ],
          audits: auditsFor(
            businessId,
            [{ collection: "businesses", id: businessId }],
            "update",
            actor,
          ),
        },
        value: next,
      };
    });
    return value;
  });
}
