import { parseCsv } from "./csv";

/**
 * 銀行・カード明細CSV(日付/摘要/出金額/入金額/残高 型)のパースと
 * 既存取引との重複候補マッチング。
 *
 * - パース本体は csv.ts の parseCsv を再利用(クォート・改行・BOM処理)
 * - ヘッダー行の列名ゆらぎを別名表で吸収し、列順の入れ替え・余分な列・
 *   先頭の口座情報行を許容する
 * - 日付は YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD / YYYY年M月D日 / 和暦
 *   (令和・R表記等)を YYYY-MM-DD へ正規化する
 * - 金額は全角数字・円記号・桁区切りを正規化し、円単位の正の整数のみ受理
 *   (残高列は参考値として読むが登録データには使わない)
 * - 「出金額/入金額」別列が取れないCSVは「金額・利用金額」単一列を
 *   支出として解釈する(カード明細向け)
 */

export interface BankCsvRowValues {
  date: string;
  description: string;
  /** 出金(支払い)列の生値 */
  withdrawal: string;
  /** 入金(預かり)列の生値 */
  deposit: string;
  /** 残高列の生値(参考表示用) */
  balance: string;
}

export interface BankCsvCandidate {
  /** YYYY-MM-DD */
  date: string;
  description: string;
  /** 円・整数・正数 */
  amount: number;
  /** 推定type(入金→income、出金/単一金額→expense)。画面側で変更可 */
  type: "income" | "expense";
}

export interface BankCsvRow {
  /** CSV上の行番号(1始まり) */
  rowNumber: number;
  values: BankCsvRowValues;
  /** 登録候補として解釈できた場合の正規化済み値。エラー・対象外行は undefined */
  candidate?: BankCsvCandidate;
  errors: string[];
  /** 取引化しない行の理由(繰越・見出し行等)。candidate/errors と排他 */
  skippedReason?: string;
}

/** 検出した列の対応(実際のヘッダー名を保持して画面で確認できるようにする) */
export interface BankCsvDetectedColumns {
  date: string;
  description: string;
  withdrawal?: string;
  deposit?: string;
  /** 単一金額列(出金/入金の別がないCSV) */
  amount?: string;
  balance?: string;
}

export interface BankCsvParseResult {
  fileError?: string;
  /**
   * 検出した金額列の形式。
   * "split" = 出金/入金の別列、"single" = 単一金額列(全行支出として解釈)
   */
  columnMode?: "split" | "single";
  detectedColumns?: BankCsvDetectedColumns;
  rows: BankCsvRow[];
}

// ---------- 列名の別名表 ----------

type ColumnKey = keyof BankCsvDetectedColumns;

/**
 * 列名のゆらぎ。主要行・ネット銀行・カードの明細CSVで使われる
 * 代表的な表記を網羅する(未収録の列名は別名表への追加で対応する方針)。
 */
const HEADER_ALIASES: Record<ColumnKey, readonly string[]> = {
  date: [
    "日付",
    "取引日",
    "お取引日",
    "お取引日付",
    "取引日付",
    "取引年月日",
    "年月日",
    "ご利用日",
    "利用日",
    "起算日",
  ],
  description: [
    "摘要",
    "摘要内容",
    "摘要・取引内容",
    "取引内容",
    "お取引内容",
    "ご利用内容",
    "利用内容",
    "内容",
    "取引先",
    "相手先",
    "相手先名",
    "利用店名",
    "利用店名・商品名",
    "店名・商品名",
    "備考",
  ],
  withdrawal: [
    "出金額",
    "出金",
    "出金金額",
    "お支払い金額",
    "お支払金額",
    "支払金額",
    "払出金額",
    "払出",
    "お引出し",
    "引出し",
    "引き出し額",
    "引落額",
    "引き落とし額",
    "支出金額",
    "支出",
  ],
  deposit: [
    "入金額",
    "入金",
    "入金金額",
    "お預かり金額",
    "お預り金額",
    "預かり金額",
    "お預入れ",
    "預入金額",
    "預入",
    "収入金額",
    "収入",
  ],
  amount: [
    "金額",
    "利用金額",
    "ご利用金額",
    "取引金額",
    "お取引金額",
    "支払総額",
    "当月お支払い金額",
  ],
  balance: ["残高", "差引残高", "現在残高", "残高額", "お預り残高"],
};

/** ヘッダーセル → 別名表照合用の正規化名(空白除去・末尾の単位括弧を除去) */
function normalizeHeaderName(name: string): string {
  return name
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/(?:[（(][^（）()]*[）)])+\s*$/, "")
    .replace(/[\s　]/g, "")
    .trim();
}

const NORMALIZED_ALIASES = new Map<string, ColumnKey>();
for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
  for (const alias of aliases) {
    NORMALIZED_ALIASES.set(normalizeHeaderName(alias), key as ColumnKey);
  }
}

/** ヘッダー行 → 認識できた列(index + 実ヘッダー名)。同名の列は先勝ち */
function detectColumns(record: string[]): {
  index: Map<ColumnKey, number>;
  names: BankCsvDetectedColumns;
} {
  const index = new Map<ColumnKey, number>();
  const names: Partial<Record<ColumnKey, string>> = {};
  record.forEach((cell, i) => {
    const key = NORMALIZED_ALIASES.get(normalizeHeaderName(cell));
    if (key !== undefined && !index.has(key)) {
      index.set(key, i);
      names[key] = cell.trim();
    }
  });
  return { index, names: names as BankCsvDetectedColumns };
}

// ---------- 日付の正規化 ----------

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 存在する日付のみ YYYY-MM-DD を返す */
function buildDateString(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return undefined;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

const ERA_KANJI_BASE: Record<string, number> = {
  令和: 2018,
  平成: 1988,
  昭和: 1925,
  大正: 1911,
  明治: 1867,
};
const ERA_ALPHA_BASE: Record<string, number> = {
  R: 2018,
  H: 1988,
  S: 1925,
  T: 1911,
  M: 1867,
};

/**
 * 明細CSVの日付表記 → YYYY-MM-DD。
 * 受理: YYYY-MM-DD / YYYY/M/D / YYYY.M.D / YYYYMMDD / YYYY年M月D日 /
 *       和暦(令和6年11月2日・R6.11.2 等。元号+元年も可)
 * 不受理(年が確定できない表記など): undefined
 */
export function normalizeBankDate(raw: string): string | undefined {
  // 全角数字の正規化後、曜日括弧・時刻部分を除去する
  const s = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[（(][^（）()]*[）)]/g, "")
    .replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, "")
    .trim();
  if (s === "") return undefined;

  let m: RegExpMatchArray | null;

  // 和暦(漢字): 令和6年11月2日 / 令和元年11月2日
  m = s.match(/^(令和|平成|昭和|大正|明治)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (m) {
    const eraYear = m[2] === "元" ? 1 : Number(m[2]);
    return buildDateString(
      ERA_KANJI_BASE[m[1]] + eraYear,
      Number(m[3]),
      Number(m[4]),
    );
  }

  // 和暦(アルファベット): R6.11.2 / R06/11/02 / H31-4-30
  m = s.match(/^([RHSTM])\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})$/i);
  if (m) {
    return buildDateString(
      ERA_ALPHA_BASE[m[1].toUpperCase()] + Number(m[2]),
      Number(m[3]),
      Number(m[4]),
    );
  }

  // YYYY年M月D日
  m = s.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (m) return buildDateString(Number(m[1]), Number(m[2]), Number(m[3]));

  // YYYYMMDD
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return buildDateString(Number(m[1]), Number(m[2]), Number(m[3]));

  // YYYY/MM/DD ・ YYYY-M-D ・ YYYY.M.D
  m = s.match(/^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})$/);
  if (m) return buildDateString(Number(m[1]), Number(m[2]), Number(m[3]));

  return undefined;
}

// ---------- 金額の正規化 ----------

type ParsedMoney =
  | { kind: "empty" }
  | { kind: "value"; value: number }
  | { kind: "invalid" };

/**
 * 金額セル → 整数円。
 * 全角数字・¥/￥/円・桁区切り・空白を正規化する。
 * `()` 囲み・▲/△/−/- 前置は負数として解釈し、小数は受理しない。
 */
function parseMoneyCell(raw: string): ParsedMoney {
  let t = raw
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[¥￥,\s　]/g, "")
    .replace(/円$/, "");
  if (t === "") return { kind: "empty" };

  let negative = false;
  const paren = t.match(/^\((.+)\)$/);
  if (paren) {
    negative = true;
    t = paren[1];
  }
  const leading = t.match(/^[▲△−‐–\-]+/);
  if (leading) {
    negative = true;
    t = t.slice(leading[0].length);
  }
  if (!/^\d+$/.test(t)) return { kind: "invalid" };
  const n = Number(t);
  if (!Number.isSafeInteger(n)) return { kind: "invalid" };
  return { kind: "value", value: negative ? -n : n };
}

// ---------- パース本体 ----------

function isBlankRecord(record: string[]): boolean {
  return record.every((cell) => cell.trim() === "");
}

/** ヘッダー行の探索は先頭からこの行数まで(口座情報等の前置行を許容) */
const HEADER_SCAN_LIMIT = 10;

function cellOf(
  record: string[],
  index: Map<ColumnKey, number>,
  key: ColumnKey,
): string {
  const i = index.get(key);
  return i === undefined ? "" : (record[i] ?? "");
}

/**
 * 銀行・カード明細CSVテキスト → 登録候補行の配列。
 *
 * - 先頭から HEADER_SCAN_LIMIT 行以内で「日付 + 金額系列」を持つ行を
 *   ヘッダーとして検出し、列名で対応付ける(列順の入れ替えを許容)
 * - 「出金額/入金額」別列があれば split モード(出金→支出/入金→収入)、
 *   なければ「金額・利用金額」単一列を支出とする single モード
 * - 必須列は 日付・摘要・金額系(出金/入金/金額のいずれか)
 * - 金額が空の行(繰越・見出し等)は skippedReason 付きで返し、
 *   エラーにはしない
 */
export function parseBankCsv(text: string): BankCsvParseResult {
  const records = parseCsv(text).filter((r) => !isBlankRecord(r));
  if (records.length === 0) {
    return { fileError: "CSVにデータ行がありません", rows: [] };
  }

  let headerAt = -1;
  let columns:
    | { index: Map<ColumnKey, number>; names: BankCsvDetectedColumns }
    | undefined;
  const scanLimit = Math.min(HEADER_SCAN_LIMIT, records.length);
  for (let i = 0; i < scanLimit; i++) {
    const detected = detectColumns(records[i]);
    if (
      detected.index.has("date") &&
      (detected.index.has("withdrawal") ||
        detected.index.has("deposit") ||
        detected.index.has("amount"))
    ) {
      headerAt = i;
      columns = detected;
      break;
    }
  }
  if (columns === undefined) {
    return {
      fileError:
        "日付・金額の列名を持つヘッダー行が見つかりません(例: 日付,摘要,出金額,入金額,残高)",
      rows: [],
    };
  }
  const index = columns.index;

  if (!index.has("description")) {
    return {
      fileError:
        "摘要(取引内容)の列が見つかりません。列名の別名は bank-csv.ts の HEADER_ALIASES を参照してください",
      rows: [],
    };
  }

  const columnMode: "split" | "single" =
    index.has("withdrawal") || index.has("deposit") ? "split" : "single";

  const dataRecords = records.slice(headerAt + 1);
  const rows = dataRecords.map((record, i) =>
    toRow(record, headerAt + 2 + i, index, columnMode),
  );

  if (rows.length === 0) {
    return {
      fileError: "CSVにデータ行がありません",
      columnMode,
      detectedColumns: columns.names,
      rows: [],
    };
  }
  return { columnMode, detectedColumns: columns.names, rows };
}

function toRow(
  record: string[],
  rowNumber: number,
  index: Map<ColumnKey, number>,
  columnMode: "split" | "single",
): BankCsvRow {
  const values: BankCsvRowValues = {
    date: cellOf(record, index, "date"),
    description: cellOf(record, index, "description"),
    withdrawal: cellOf(record, index, "withdrawal"),
    deposit: cellOf(record, index, "deposit"),
    balance: cellOf(record, index, "balance"),
  };
  const errors: string[] = [];

  const date = normalizeBankDate(values.date);
  if (date === undefined) {
    errors.push(
      values.date.trim() === ""
        ? "日付が空です"
        : `日付「${values.date.trim()}」を解釈できません`,
    );
  }

  const description = values.description.trim();
  if (description.length > 500) {
    errors.push("摘要が500文字を超えています");
  }

  let amount: number | undefined;
  let type: "income" | "expense" | undefined;
  let skippedReason: string | undefined;

  if (columnMode === "split") {
    const w = parseMoneyCell(values.withdrawal);
    const d = parseMoneyCell(values.deposit);
    if (w.kind === "invalid") errors.push("出金額を数値に変換できません");
    if (d.kind === "invalid") errors.push("入金額を数値に変換できません");
    const wv = w.kind === "value" ? w.value : 0;
    const dv = d.kind === "value" ? d.value : 0;
    if (wv < 0 || dv < 0) {
      errors.push("負の金額は取り込めません(返金等は個別に登録してください)");
    } else if (wv > 0 && dv > 0) {
      errors.push("出金額と入金額の両方に値があります");
    } else if (wv > 0) {
      amount = wv;
      type = "expense";
    } else if (dv > 0) {
      amount = dv;
      type = "income";
    } else if (errors.length === 0) {
      skippedReason = "金額列が空です(繰越・見出し等の取引でない行とみなします)";
    }
  } else {
    const a = parseMoneyCell(cellOf(record, index, "amount"));
    if (a.kind === "invalid") {
      errors.push("金額を数値に変換できません");
    } else if (a.kind === "value") {
      if (a.value < 0) {
        errors.push("負の金額は取り込めません(返金等は個別に登録してください)");
      } else if (a.value > 0) {
        amount = a.value;
        type = "expense";
      } else {
        skippedReason = "金額が0円のため対象外です";
      }
    } else {
      skippedReason = "金額列が空です(取引でない行とみなします)";
    }
  }

  const candidate =
    errors.length === 0 &&
    skippedReason === undefined &&
    date !== undefined &&
    amount !== undefined &&
    type !== undefined
      ? { date, description, amount, type }
      : undefined;

  return { rowNumber, values, candidate, errors, skippedReason };
}

// ---------- 重複候補のマッチング ----------

export interface ExistingTransactionRef {
  id: string;
  date: string;
  amount: number;
}

export interface ExistingMatch {
  transaction: ExistingTransactionRef;
  /** 候補日付との差(日数・絶対値) */
  dayDiff: number;
}

function dateToDays(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** YYYY-MM-DD を days 日ずらした YYYY-MM-DD(照合範囲の算出用) */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/**
 * 既存取引との重複可能性チェック。
 * AI提案の duplicate_detection と同種のルール(金額一致)に
 * 「近日付」の幅を持たせたクライアント側判定。
 * 同金額かつ日付差が maxDayDiff 日以内の既存取引を日付差順で返す。
 */
export function findExistingMatches(
  candidate: { date: string; amount: number },
  existing: readonly ExistingTransactionRef[],
  maxDayDiff = 3,
): ExistingMatch[] {
  const base = dateToDays(candidate.date);
  return existing
    .filter((t) => t.amount === candidate.amount)
    .map((t) => ({
      transaction: t,
      dayDiff: Math.abs(dateToDays(t.date) - base),
    }))
    .filter((m) => m.dayDiff <= maxDayDiff)
    .sort((a, b) => a.dayDiff - b.dayDiff);
}

/**
 * 同一CSV内の重複候補(日付・種別・金額が一致する行)を検出する。
 * 戻り値は 行番号 → 重複相手の行番号一覧。
 */
export function findInFileDuplicatePartners(
  rows: readonly BankCsvRow[],
): Map<number, number[]> {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const c = r.candidate;
    if (!c) continue;
    const key = `${c.date}|${c.type}|${c.amount}`;
    groups.set(key, [...(groups.get(key) ?? []), r.rowNumber]);
  }
  const partners = new Map<number, number[]>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const n of members) {
      partners.set(
        n,
        members.filter((m) => m !== n),
      );
    }
  }
  return partners;
}
