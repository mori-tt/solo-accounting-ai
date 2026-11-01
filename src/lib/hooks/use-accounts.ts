"use client";

import { useMemo } from "react";
import { useApp } from "@/components/auth-provider";
import {
  accountOptionsFor,
  getAccountOptions,
  type AccountOption,
} from "@/lib/accounts";

/**
 * 現在の事業の科目解決を共通化するフック。
 * 標準科目(ACCOUNT_OPTIONS)に business.customAccounts をマージした
 * getAccountOptions の結果をもとに、画面側が必要とする形を返す。
 *
 * - options: 無効科目を含む全科目(ラベル解決・CSV出力用)
 * - label: 科目コード → 表示名(未定義コードはそのまま返す)
 * - optionsFor: 取引種別で絞った選択肢(無効科目は除外)
 * - activeCodes: 有効な科目コード一覧(AI候補・CSV照合用)
 */
export function useAccounts(): {
  options: AccountOption[];
  label: (code: string) => string;
  optionsFor: (kind: "income" | "expense" | "transfer") => AccountOption[];
  activeCodes: string[];
} {
  const { business } = useApp();
  return useMemo(() => {
    const options = getAccountOptions(business);
    const labelMap = new Map(options.map((a) => [a.code, a.label]));
    return {
      options,
      label: (code: string) => labelMap.get(code) ?? code,
      optionsFor: (kind: "income" | "expense" | "transfer") =>
        accountOptionsFor(kind, options),
      activeCodes: options.filter((a) => !a.disabled).map((a) => a.code),
    };
  }, [business]);
}
