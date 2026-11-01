import { z } from "zod";
import { MAX_LIST_LIMIT } from "@/lib/ai/store";
import { SUGGESTION_KINDS, SUGGESTION_STATUSES } from "@/lib/ai/types";

/**
 * フォーム入力の検証スキーマ。
 * クライアント側で即時エラー表示し、Server Actions側でも同じスキーマで再検証する
 * (クライアント検証はUX、サーバー検証は安全性のため)。
 * 金額は円単位の整数、日付はYYYY-MM-DD(FIRESTORE_SCHEMA.md / ACCOUNTING_RULES.md)。
 */

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD形式で入力してください")
  .refine(
    (v) => {
      const [y, m, d] = v.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      return (
        date.getUTCFullYear() === y &&
        date.getUTCMonth() === m - 1 &&
        date.getUTCDate() === d
      );
    },
    { message: "存在しない日付です" },
  );

/** 金額(円・整数・正数)。取引・請求・入金の登録額。 */
export const yenAmount = z
  .number({ error: "金額は数値で入力してください" })
  .int("金額は円単位の整数で入力してください")
  .positive("金額は1円以上で入力してください");

/** 0円を許容する金額(税額・単価など) */
export const nonNegativeYen = z
  .number({ error: "金額は数値で入力してください" })
  .int("金額は円単位の整数で入力してください")
  .nonnegative("金額は0円以上で入力してください");

export const monthKey = z
  .string()
  .regex(/^\d{6}$/, "YYYYMM形式で指定してください")
  .refine(
    (v) => {
      const m = Number(v.slice(4, 6));
      return m >= 1 && m <= 12;
    },
    { message: "月は01〜12で指定してください" },
  );

const optionalText = z
  .string()
  .max(500, "500文字以内で入力してください")
  .optional();

const emailOptional = z
  .union([z.literal(""), z.email("メールアドレスの形式が正しくありません")])
  .optional();

export const loginSchema = z.object({
  email: z.email("メールアドレスの形式が正しくありません"),
  password: z.string().min(6, "パスワードは6文字以上で入力してください"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const businessSchema = z.object({
  name: z.string().min(1, "事業名を入力してください").max(100),
  fiscalYearStartMonth: z
    .number()
    .int("1〜12の整数で入力してください")
    .min(1, "1〜12で入力してください")
    .max(12, "1〜12で入力してください"),
  taxMode: z.enum(["exempt", "simple", "standard"]),
});
export type BusinessInput = z.infer<typeof businessSchema>;

export const openingBalanceEntrySchema = z.object({
  fiscalYear: z
    .number({ error: "会計年度は数値で入力してください" })
    .int("会計年度は整数で入力してください")
    .min(1900, "会計年度が不正です")
    .max(2200, "会計年度が不正です"),
  accountCode: z
    .string()
    .min(1, "勘定科目を入力してください")
    .max(50, "科目コードは50文字以内で入力してください"),
  amount: z
    .number({ error: "金額は数値で入力してください" })
    .int("金額は円単位の整数で入力してください"),
});
export const openingBalancesSchema = z
  .array(openingBalanceEntrySchema)
  .max(500, "期首残高は500件以内で登録してください")
  .refine(
    (list) =>
      new Set(list.map((b) => `${b.fiscalYear}:${b.accountCode}`)).size ===
      list.length,
    { message: "同じ年度・科目の期首残高が重複しています" },
  );
export type OpeningBalancesInput = z.infer<typeof openingBalancesSchema>;

export const memberInviteSchema = z.object({
  email: z.email("メールアドレスの形式が正しくありません"),
  role: z.enum(["editor", "viewer"]),
});
export type MemberInviteInput = z.infer<typeof memberInviteSchema>;

export const taxCategorySchema = z.enum([
  "taxable",
  "non_taxable",
  "exempt",
  "out_of_scope",
]);

export const transactionSchema = z
  .object({
    type: z.enum(["income", "expense", "transfer"]),
    date: dateString,
    amount: yenAmount,
    account: z.string().min(1, "勘定科目を選択してください"),
    counterparty: optionalText,
    description: optionalText,
    /**
     * 消費税区分/税率。更新時: 省略(undefined)=既存値を保持、
     * null=クリア、値=設定。フォームは必ず値かnullを送る。
     */
    taxCategory: taxCategorySchema.nullable().optional(),
    taxRate: z.enum(["standard", "reduced"]).nullable().optional(),
  })
  .refine((v) => v.taxRate == null || v.taxCategory === "taxable", {
    message: "税率は課税取引の場合のみ指定できます",
    path: ["taxRate"],
  });
export type TransactionInput = z.infer<typeof transactionSchema>;

export const expenseSchema = z.object({
  date: dateString,
  amount: yenAmount,
  account: z.string().min(1, "勘定科目を選択してください"),
  counterparty: optionalText,
  description: optionalText,
  taxCategory: taxCategorySchema,
  taxAmount: nonNegativeYen.optional(),
  paymentDueDate: z.union([dateString, z.literal("")]).optional(),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const customerSchema = z.object({
  name: z.string().min(1, "顧客名を入力してください").max(200),
  email: emailOptional,
  address: optionalText,
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const projectSchema = z.object({
  customerId: z.string().min(1, "顧客を選択してください"),
  name: z.string().min(1, "案件名を入力してください").max(200),
});
export type ProjectInput = z.infer<typeof projectSchema>;

export const invoiceItemSchema = z.object({
  description: z.string().min(1, "明細の内容を入力してください").max(500),
  quantity: z
    .number({ error: "数量は数値で入力してください" })
    .int("数量は整数で入力してください")
    .positive("数量は1以上で入力してください"),
  unitPrice: nonNegativeYen,
  taxRate: z.enum(["standard", "reduced"]).optional(),
});
export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

export const invoiceSchema = z
  .object({
    customerId: z.string().min(1, "顧客を選択してください"),
    projectId: z.string().optional(),
    issueDate: dateString,
    dueDate: dateString,
    items: z.array(invoiceItemSchema).min(1, "明細を1行以上入力してください"),
  })
  .refine((v) => v.dueDate >= v.issueDate, {
    message: "支払期日は発行日以降の日付にしてください",
    path: ["dueDate"],
  });
export type InvoiceInput = z.infer<typeof invoiceSchema>;

export const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  date: dateString,
  amount: yenAmount,
});
export type PaymentInput = z.infer<typeof paymentSchema>;

// ---------- AI提案 API(api/ai/suggestions) ----------

export const aiTargetTypeSchema = z.enum([
  "receipt",
  "transaction",
  "monthlySummary",
]);
export const aiSuggestionKindSchema = z.enum(SUGGESTION_KINDS);
export const aiSuggestionStatusSchema = z.enum(SUGGESTION_STATUSES);

/** POST /api/ai/suggestions(提案実行)のリクエストボディ */
export const runSuggestionSchema = z.object({
  businessId: z.string().min(1),
  kind: aiSuggestionKindSchema,
  target: z.object({
    type: aiTargetTypeSchema,
    id: z.string().min(1).max(200),
  }),
  input: z.record(z.string(), z.unknown()).optional(),
});
export type RunSuggestionInput = z.infer<typeof runSuggestionSchema>;

/** PATCH /api/ai/suggestions/{id}(承認/却下)のリクエストボディ */
export const decideSuggestionSchema = z.object({
  businessId: z.string().min(1),
  decision: z.enum(["accepted", "rejected"]),
  rejectReason: z.string().max(500).optional(),
});
export type DecideSuggestionInput = z.infer<typeof decideSuggestionSchema>;

/** GET /api/ai/suggestions(一覧)のクエリパラメータ */
export const listSuggestionQuerySchema = z.object({
  businessId: z.string().min(1),
  targetType: aiTargetTypeSchema.optional(),
  targetId: z.string().min(1).max(200).optional(),
  kind: aiSuggestionKindSchema.optional(),
  status: aiSuggestionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
});
export type ListSuggestionQuery = z.infer<typeof listSuggestionQuerySchema>;

/** 安全側の検証。失敗時は issues を返す */
export function parseForm<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { success: true; data: T } | { success: false; issues: string[] } {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    issues: result.error.issues.map(
      (i) => `${i.path.join(".") ? `${i.path.join(".")}: ` : ""}${i.message}`,
    ),
  };
}
