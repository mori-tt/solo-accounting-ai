import type { AIProvider, AIRequest } from "./provider";

/**
 * 外部AI APIを使わない開発・Emulator用の決定論的プロバイダ。
 * 本番プロバイダ(LLM等)に差し替えられるようAIProviderを実装する。
 * input.ocrText 等の入力はログ出力しない。
 */
export class HeuristicAIProvider implements AIProvider {
  async generate(request: AIRequest): Promise<unknown> {
    switch (request.kind) {
      case "receipt_extraction":
        return this.extractReceipt(request.input);
      case "account_suggestion":
        return this.suggestAccount(request.input);
      case "duplicate_detection":
        return this.detectDuplicates(request.input);
      case "transaction_description":
        return this.describeTransaction(request.input);
      case "monthly_explanation":
        return this.explainMonthly(request.input);
    }
  }

  private extractReceipt(input: Record<string, unknown>): unknown {
    const text = typeof input.ocrText === "string" ? input.ocrText : "";

    const amountMatch = text.match(
      /(?:合計|小計|金額)?[^\d]{0,8}?[¥￥]?\s?(\d{1,3}(?:,\d{3})+|\d{2,})\s?円?/,
    );
    const dateMatch = text.match(
      /(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?/,
    );
    const vendorLine = text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !/[¥￥\d]{3,}/.test(l));

    const issues: string[] = [];
    if (!amountMatch) issues.push("amount_unreadable");
    if (!dateMatch) issues.push("date_unreadable");

    return {
      amount: amountMatch
        ? Number(amountMatch[1].replace(/,/g, ""))
        : undefined,
      date: dateMatch
        ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
        : undefined,
      vendor: vendorLine ?? undefined,
      confidence: issues.length === 0 ? 0.7 : 0.3,
      reason: "OCRテキストから金額・日付・取引先を抽出しました",
    };
  }

  private suggestAccount(input: Record<string, unknown>): unknown {
    const text = `${input.counterparty ?? ""} ${input.description ?? ""}`;
    const rules: [RegExp, string, string][] = [
      [/交通|電車|バス|タクシー|Suica|IC/i, "travel", "交通関連の語句を含むため"],
      [/会議|打合|飲食|レストラン|カフェ/i, "entertainment", "飲食・会合関連の語句を含むため"],
      [/文具|事務|コピー|オフィス/i, "supplies", "事務用品関連の語句を含むため"],
      [/通信|携帯|Wi-Fi|インターネット/i, "communication", "通信関連の語句を含むため"],
    ];
    const hit = rules.find(([re]) => re.test(text));
    return {
      candidates: [
        {
          account: hit ? hit[1] : "miscellaneous",
          confidence: hit ? 0.6 : 0.2,
          reason: hit ? hit[2] : "該当する分類手がかりが見つかりませんでした",
        },
      ],
      confidence: hit ? 0.6 : 0.2,
      reason: hit ? hit[2] : "分類手がかり不足のため汎用科目を提示",
    };
  }

  private detectDuplicates(input: Record<string, unknown>): unknown {
    const target = input.transaction as
      | { id?: string; amount?: number; date?: string }
      | undefined;
    const existing = Array.isArray(input.existingTransactions)
      ? (input.existingTransactions as {
          id?: string;
          amount?: number;
          date?: string;
        }[])
      : [];

    const candidates = existing
      .filter(
        (t) =>
          t.id &&
          t.id !== target?.id &&
          t.amount === target?.amount &&
          t.date === target?.date,
      )
      .map((t) => ({
        transactionId: t.id as string,
        score: 0.8,
        reason: "金額と日付が一致する既存取引があります",
      }));

    return {
      candidates,
      confidence: candidates.length > 0 ? 0.8 : 0.1,
      reason:
        candidates.length > 0
          ? "金額・日付一致の取引を重複候補として提示"
          : "重複候補は見つかりませんでした",
    };
  }

  private describeTransaction(input: Record<string, unknown>): unknown {
    const counterparty =
      typeof input.counterparty === "string" ? input.counterparty : "";
    const amount = typeof input.amount === "number" ? input.amount : null;
    const date = typeof input.date === "string" ? input.date : null;
    return {
      description: `${date ?? "日付不明"} ${counterparty || "取引先不明"}への${amount !== null ? `${amount}円` : "金額不明"}の支払い`,
      confidence: 0.5,
      reason: "取引の属性情報から説明文を生成しました",
    };
  }

  private explainMonthly(input: Record<string, unknown>): unknown {
    const summary = input.summary as
      | { totalIncome?: number; totalExpense?: number }
      | undefined;
    const prev = input.previousSummary as
      | { totalIncome?: number; totalExpense?: number }
      | undefined;
    const income = summary?.totalIncome ?? 0;
    const expense = summary?.totalExpense ?? 0;
    const prevExpense = prev?.totalExpense ?? 0;
    const diff = expense - prevExpense;
    return {
      explanation: `今月の収入は${income}円、支出は${expense}円です。前月比の支出変動は${diff >= 0 ? "+" : ""}${diff}円です。`,
      highlights:
        diff !== 0
          ? [`支出が前月比${Math.abs(diff)}円${diff > 0 ? "増加" : "減少"}`]
          : [],
      confidence: 0.5,
      reason: "月次集計値の差分から説明を生成しました",
    };
  }
}
