import type { Transaction, TransactionType } from "@/lib/accounting/types";
import {
  ACCOUNT_OPTIONS,
  accountLabelIn,
  type AccountOption,
} from "@/lib/accounts";
import {
  dateString,
  parseForm,
  transactionSchema,
  type TransactionInput,
} from "@/lib/validation/schemas";

/**
 * CSVユーティリティ(外部依存なしの自前実装)。
 *
 * - serializeCsv: RFC 4180 系。フィールド内の `,` `"` 改行を
 *   ダブルクォートで囲み、内部の `"` は `""` にエスケープする。
 *   行末は CRLF(Excel互換)。
 * - parseCsv: クォート内改行・`""` エスケープ・CRLF/LF/CR を受理する。
 * - decodeCsvBytes: BOM による UTF-8/UTF-16 検出と、UTF-8で解釈不能な
 *   バイト列の Shift_JIS フォールバック。
 * - 取引CSVのエクスポート列定義・インポート行検証。
 */

/** ExcelがUTF-8を正しく認識するためのBOM。ダウンロード時に先頭へ付ける */
export const CSV_UTF8_BOM = "\uFEFF";

// ---------- 生成 ----------

function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 行配列 → CSV文字列(行末CRLF)。BOMは含まない */
export function serializeCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeField).join(",")).join("\r\n");
}

// ---------- パース ----------

/**
 * CSV文字列 → 行配列。
 * - クォートされたフィールド内の改行・カンマ・`""` を正しく処理する
 * - 先頭のBOMは除去する
 * - 末尾改行の後に空行を作らない
 * - クォート位置が不正でも可能な範囲で読む(寛容モード)
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  // 直前が行頭(ファイル開始・改行直後)なら true。
  // 末尾改行の後に空レコードを作らない判定に使う
  let atLineStart = true;

  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    rows.push(record);
    record = [];
  };

  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      atLineStart = false;
      continue;
    }
    if (c === ",") {
      endField();
      atLineStart = false;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      atLineStart = true;
      continue;
    }
    field += c;
    atLineStart = false;
  }
  // ファイル末尾にレコードが残っていれば flush。
  // 末尾が改行の場合、record・field ともに空なので追加しない
  if (!atLineStart || record.length > 0 || field !== "") {
    endField();
    rows.push(record);
  }
  return rows;
}

// ---------- デコード ----------

export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be" | "shift_jis";

/**
 * ファイルバイト列 → テキスト。
 * BOMがあればそれに従う。なければUTF-8として解釈を試み、
 * 不正なバイト列ならShift_JIS(Excelの日本語CSV)として解釈する。
 */
export function decodeCsvBytes(bytes: Uint8Array): {
  text: string;
  encoding: CsvEncoding;
} {
  // UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  // UTF-16 BOM
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, encoding: "utf-8" };
  } catch {
    // UTF-8として解釈できないバイト列はShift_JISとみなす
    return { text: new TextDecoder("shift_jis").decode(bytes), encoding: "shift_jis" };
  }
}

// ---------- 取引CSV ----------

/** エクスポート・インポート共通の列ヘッダー */
export const TRANSACTION_CSV_HEADER = [
  "日付",
  "種別",
  "科目コード",
  "科目名",
  "取引先",
  "摘要",
  "金額",
  "状態",
] as const;

const TYPE_TO_LABEL: Record<TransactionType, string> = {
  income: "収入",
  expense: "支出",
  transfer: "振替",
};

const STATUS_TO_LABEL: Record<Transaction["status"], string> = {
  draft: "下書き",
  confirmed: "確定",
  locked: "締め済み",
};

/** 取引1件 → CSV行(エクスポート列順)。科目名は options(標準+カスタム)で解決 */
export function transactionToCsvRow(
  t: Transaction,
  options: readonly AccountOption[] = ACCOUNT_OPTIONS,
): string[] {
  return [
    t.date,
    TYPE_TO_LABEL[t.type] ?? t.type,
    t.account,
    accountLabelIn(options, t.account),
    t.counterparty,
    t.description,
    String(t.amount),
    STATUS_TO_LABEL[t.status] ?? t.status,
  ];
}

/** 取引一覧 → ヘッダー付きCSV文字列(BOMなし) */
export function buildTransactionsCsv(
  transactions: readonly Transaction[],
  options: readonly AccountOption[] = ACCOUNT_OPTIONS,
): string {
  return serializeCsv([
    [...TRANSACTION_CSV_HEADER],
    ...transactions.map((t) => transactionToCsvRow(t, options)),
  ]);
}

// ---------- インポート行の検証 ----------

const TYPE_FROM_TEXT: Record<string, TransactionType> = {
  収入: "income",
  支出: "expense",
  振替: "transfer",
};

/** 科目コード照合に使う2集合。有効=取込可、無効=定義済みだが無効化済み */
function accountCodeSets(options: readonly AccountOption[]): {
  active: Set<string>;
  disabled: Set<string>;
} {
  const active = new Set<string>();
  const disabled = new Set<string>();
  for (const a of options) {
    (a.disabled ? disabled : active).add(a.code);
  }
  return { active, disabled };
}

/** プレビュー表示用に解釈した各列の生値 */
export interface TransactionCsvRowValues {
  date: string;
  type: string;
  accountCode: string;
  counterparty: string;
  description: string;
  amount: string;
}

export interface TransactionCsvRow {
  /** CSV上の行番号(1始まり。ヘッダー行がある場合は2始まり) */
  rowNumber: number;
  values: TransactionCsvRowValues;
  /** バリデーション通過時の登録入力。エラー行は undefined */
  input?: TransactionInput;
  errors: string[];
}

export interface TransactionCsvParseResult {
  /** ファイル全体の問題(必須列なし等)。行データは返る場合がある */
  fileError?: string;
  rows: TransactionCsvRow[];
}

/** 全セルが空のレコード(空行)を取り除く */
function isBlankRecord(record: string[]): boolean {
  return record.every((cell) => cell.trim() === "");
}

function parseAmount(raw: string): number | undefined {
  // 全角数字・￥記号・桁区切り・空白を正規化して整数円のみ受理する
  const normalized = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[¥￥,\s　]/g, "");
  if (!/^\d+$/.test(normalized)) return undefined;
  const n = Number(normalized);
  if (!Number.isSafeInteger(n) || n <= 0) return undefined;
  return n;
}

function validateRow(
  values: TransactionCsvRowValues,
  accountCodes: { active: Set<string>; disabled: Set<string> },
): {
  input?: TransactionInput;
  errors: string[];
} {
  const errors: string[] = [];

  const date = values.date.trim();
  if (date === "") {
    errors.push("日付が未入力です");
  } else {
    const parsed = dateString.safeParse(date);
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((i) => `日付: ${i.message}`));
    }
  }

  const typeText = values.type.trim();
  const type =
    TYPE_FROM_TEXT[typeText] ??
    (["income", "expense", "transfer"].includes(typeText.toLowerCase())
      ? (typeText.toLowerCase() as TransactionType)
      : undefined);
  if (type === undefined) {
    errors.push(
      typeText === ""
        ? "種別が未入力です"
        : `種別「${typeText}」は不正です(収入/支出/振替)`,
    );
  }

  const account = values.accountCode.trim();
  if (account === "") {
    errors.push("科目コードが未入力です");
  } else if (accountCodes.disabled.has(account)) {
    errors.push(`科目コード「${account}」は無効化されています`);
  } else if (!accountCodes.active.has(account)) {
    errors.push(`科目コード「${account}」は定義されていません`);
  }

  const amount = parseAmount(values.amount);
  if (amount === undefined) {
    errors.push(
      values.amount.trim() === ""
        ? "金額が未入力です"
        : "金額は1円以上の整数で入力してください",
    );
  }

  if (values.counterparty.length > 500) {
    errors.push("取引先は500文字以内で入力してください");
  }
  if (values.description.length > 500) {
    errors.push("摘要は500文字以内で入力してください");
  }

  if (errors.length > 0) return { errors };

  const input = {
    type: type as TransactionType,
    date,
    amount: amount as number,
    account,
    counterparty: values.counterparty || undefined,
    description: values.description || undefined,
  };
  // サーバー側と同一スキーマでの最終確認(保守でズレた場合の安全網)
  const parsed = parseForm(transactionSchema, input);
  if (!parsed.success) return { errors: parsed.issues };
  return { input: parsed.data, errors: [] };
}

const HEADER_ALIASES: Record<keyof TransactionCsvRowValues, string[]> = {
  date: ["日付"],
  type: ["種別"],
  accountCode: ["科目コード"],
  counterparty: ["取引先"],
  description: ["摘要"],
  amount: ["金額"],
};

/** ヘッダー行から列名→列indexの対応を作る。未認識の列は無視 */
function headerIndex(header: string[]): Map<keyof TransactionCsvRowValues, number> {
  const map = new Map<keyof TransactionCsvRowValues, number>();
  header.forEach((cell, index) => {
    const name = cell.trim();
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(name)) {
        map.set(key as keyof TransactionCsvRowValues, index);
      }
    }
  });
  return map;
}

/** ヘッダーなしCSVの列順(エクスポート形式。index 3 の科目名は読まない) */
const POSITIONAL_INDEX = new Map<keyof TransactionCsvRowValues, number>([
  ["date", 0],
  ["type", 1],
  ["accountCode", 2],
  ["counterparty", 4],
  ["description", 5],
  ["amount", 6],
]);
const POSITIONAL_MIN_COLUMNS = 7;

function valuesFromRecord(
  record: string[],
  index: Map<keyof TransactionCsvRowValues, number>,
): TransactionCsvRowValues {
  const get = (key: keyof TransactionCsvRowValues) => {
    const i = index.get(key);
    return i === undefined ? "" : (record[i] ?? "");
  };
  return {
    date: get("date"),
    type: get("type"),
    accountCode: get("accountCode"),
    counterparty: get("counterparty"),
    description: get("description"),
    amount: get("amount"),
  };
}

/**
 * 取引CSVテキスト → 検証済み行配列。
 *
 * - 先頭がヘッダー行なら列名で対応付ける(列順の入れ替え・余分な列を許容)。
 *   必須は 日付/種別/科目コード/金額 の4列
 * - ヘッダーがなければエクスポートと同じ列順(日付,種別,科目コード,科目名,
 *   取引先,摘要,金額[,状態])とみなす
 * - 取込では常に draft として登録するため 状態・科目名 列は読まない
 * - 科目コードの照合は options(標準+カスタム科目)に対して行い、
 *   無効化された科目は取り込めない
 */
export function parseTransactionsCsv(
  text: string,
  options: readonly AccountOption[] = ACCOUNT_OPTIONS,
): TransactionCsvParseResult {
  const accountCodes = accountCodeSets(options);
  const records = parseCsv(text).filter((r) => !isBlankRecord(r));
  if (records.length === 0) {
    return { fileError: "CSVにデータ行がありません", rows: [] };
  }

  const first = records[0];
  // 先頭行に既知の列名が2つ以上あればヘッダーとみなす。
  // (列順入れ替えを許容しつつ、データ行の誤検出を避ける)
  const detected = headerIndex(first);
  const hasHeader = detected.size >= 2;

  let index: Map<keyof TransactionCsvRowValues, number>;
  let dataRecords: string[][];
  let firstRowNumber: number;
  if (hasHeader) {
    index = detected;
    const missing = (Object.keys(HEADER_ALIASES) as (keyof TransactionCsvRowValues)[])
      .filter((k) => !index.has(k) && k !== "counterparty" && k !== "description")
      .map((k) => HEADER_ALIASES[k][0]);
    if (missing.length > 0) {
      return {
        fileError: `必須列がありません: ${missing.join("・")}`,
        rows: [],
      };
    }
    dataRecords = records.slice(1);
    firstRowNumber = 2;
  } else {
    index = POSITIONAL_INDEX;
    dataRecords = records;
    firstRowNumber = 1;
  }

  const rows = dataRecords.map((record, i) => {
    const rowNumber = firstRowNumber + i;
    const errors: string[] = [];
    if (!hasHeader && record.length < POSITIONAL_MIN_COLUMNS) {
      return {
        rowNumber,
        values: valuesFromRecord(record, index),
        errors: [
          `列数が不足しています(${POSITIONAL_MIN_COLUMNS}列以上必要です)`,
        ],
      };
    }
    const values = valuesFromRecord(record, index);
    const validated = validateRow(values, accountCodes);
    errors.push(...validated.errors);
    return { rowNumber, values, input: validated.input, errors };
  });

  if (rows.length === 0) {
    return { fileError: "CSVにデータ行がありません", rows: [] };
  }
  return { rows };
}
