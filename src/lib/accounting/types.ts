import type { DateString } from "./dates";
import type { ConsumptionTaxRate } from "./domain/tax";

/**
 * docs/FIRESTORE_SCHEMA.md に対応するドメイン型。
 * 日時フィールドはドメイン内では ISO 8601 文字列として扱い、
 * Firestore への変換は store 層が担う。
 */

/**
 * 消費税課税方式。
 * special20 = 2割特例(インボイス制度移行措置。免税→課税転換事業者向け。
 * 適用対象は 2023-10-01〜2026-09-30 の日の属する課税期間)。
 */
export type TaxMode = "exempt" | "simple" | "standard" | "special20";

export type MemberRole = "owner" | "editor" | "viewer";

/**
 * 料金プラン。機能可否の判定は src/lib/billing.ts の
 * PlanEntitlements が担う。決済プロバイダ接続前のため値の更新は
 * サーバー側(Admin SDK)のみが行い、クライアントからは変更できない
 */
export type BusinessPlan = "free" | "pro";

export type TransactionType = "income" | "expense" | "transfer";

export type TransactionStatus = "draft" | "confirmed" | "locked";

export type TaxCategory = "taxable" | "non_taxable" | "exempt" | "out_of_scope";

export type ReceiptStatus = "unprocessed" | "linked" | "archived";

export type ProjectStatus = "active" | "done" | "archived";

export type InvoiceStatus = "draft" | "issued" | "paid" | "overdue";

export type QuoteStatus = "draft" | "sent" | "accepted" | "converted";

/** 受領請求書(買掛)の状態。期限超過は dueDate から都度判定するため保持しない */
export type BillStatus = "unpaid" | "paid";

export type FiscalPeriodStatus = "open" | "closed";

export type AuditAction = "create" | "update" | "delete" | "close";

/** 事業ごとのカスタム勘定科目・補助科目(businessドキュメント内・最大50件) */
export interface CustomAccount {
  /** 科目コード。事業内一意・英数字 */
  code: string;
  label: string;
  kind: "income" | "expense";
  /** 補助科目の場合の親科目コード(標準科目または他のカスタム科目) */
  parentCode?: string;
  /** 無効化すると新規選択肢・照合から外れる(既存取引の表示は維持) */
  disabled?: boolean;
}

/** 年度ごとの期首残高(businessドキュメント内に保持) */
export interface OpeningBalance {
  /** 適用する会計年度(開始年) */
  fiscalYear: number;
  /** 勘定科目コード */
  accountCode: string;
  /** 円・整数。借方残高を正、貸方残高を負とする */
  amount: number;
}

export interface Business {
  id: string;
  name: string;
  ownerUid: string;
  fiscalYearStartMonth: number;
  taxMode: TaxMode;
  customAccounts?: CustomAccount[];
  /** 家事按分の事業割合(%)。科目コード→0-100の整数。未設定科目は100%扱い */
  allocationRatios?: Record<string, number>;
  /** 年度ごとの期首残高(資産系科目+任意コード)。未設定は空扱い */
  openingBalances?: OpeningBalance[];
  /** 最終バックアップ(エクスポート)日時。未取得は undefined */
  lastBackupAt?: string;
  /** 適格請求書発行事業者の登録番号(T+13桁)。未登録(免税事業者等)は未設定 */
  invoiceRegistrationNumber?: string;
  /** 請求書の発行者名(屋号・氏名)。未設定時は事業名を使う */
  issuerName?: string;
  /** 請求書に記載する発行者の住所 */
  issuerAddress?: string;
  /** 請求書番号の採番カウンタ(発行済みの最終連番)。未採番は未設定 */
  invoiceCounter?: number;
  /** 見積番号の採番カウンタ(発行済みの最終連番)。未採番は未設定 */
  quoteCounter?: number;
  /** 料金プラン。未設定(課金導入前のデータ)は free 扱い */
  plan?: BusinessPlan;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  date: DateString;
  /** 円・整数・正数 */
  amount: number;
  /** 勘定科目コード */
  account: string;
  counterparty: string;
  description: string;
  receiptIds: string[];
  status: TransactionStatus;
  /** 消費税区分。未設定は区分未分類(税フィールド導入前データの後方互換) */
  taxCategory?: TaxCategory;
  /** 税率区分。taxCategory=taxable のときのみ有効(省略時 standard) */
  taxRate?: ConsumptionTaxRate;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  transactionId: string;
  taxCategory: TaxCategory;
  /** 消費税額(円・整数・0以上) */
  taxAmount: number;
  paymentDueDate?: DateString;
  paidAt?: DateString;
}

/** 源泉徴収の支払区分。service_fee=報酬・料金等(支払調書)、salary=給与(源泉徴収票) */
export type WithholdingCategory = "service_fee" | "salary";

/** 源泉徴収税額の求め方。auto=税率で自動計算、manual=手入力 */
export type WithholdingCalculation = "auto" | "manual";

/**
 * 源泉徴収の記録。expense型Transactionに1対1で紐付く
 * (ドキュメントID = transactionId で一意性を構造保証する)。
 * レコードの存在自体が「源泉徴収対象」フラグを兼ねる。
 */
export interface WithholdingRecord {
  /** ドキュメントID = transactionId */
  id: string;
  /** 対象取引(expense型のみ) */
  transactionId: string;
  /** 支払区分 */
  category: WithholdingCategory;
  /** 源泉徴収の対象となった支払金額(円・整数・正数) */
  paymentAmount: number;
  /** 源泉徴収税額(円・整数・0以上) */
  taxAmount: number;
  /** taxAmount の求め方(自動計算か手入力かの記録) */
  calculation: WithholdingCalculation;
  /** 支払調書の細目欄に使うメモ(任意) */
  note?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Receipt {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  transactionId?: string;
  status: ReceiptStatus;
  /**
   * 電帳法の検索要件(取引年月日/金額/取引先)を証憑単体で満たすための
   * メタデータ。紐付け時に取引の値をコピーし、未紐付の証憑は手入力で補う。
   */
  transactionDate?: DateString;
  /** 円・整数・0以上 */
  amount?: number;
  counterparty?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  address?: string;
  createdAt: string;
}

export interface Project {
  id: string;
  customerId: string;
  name: string;
  status: ProjectStatus;
  createdAt: string;
}

export interface InvoiceItem {
  description: string;
  /** 正の整数 */
  quantity: number;
  /** 円・整数・0以上(税込) */
  unitPrice: number;
  /** 円・整数 = quantity * unitPrice(税込) */
  amount: number;
  /** 税率区分。省略時は標準税率(税フィールド導入前データの後方互換) */
  taxRate?: ConsumptionTaxRate;
  /** 明細に含まれる消費税額(円・整数)。登録時にサーバーで算出 */
  taxAmount?: number;
}

export interface Invoice {
  id: string;
  /** 請求書番号(事業内連番・作成時に採番)。連番導入前のデータは未設定 */
  invoiceNumber?: string;
  customerId: string;
  projectId?: string;
  issueDate: DateString;
  dueDate: DateString;
  items: InvoiceItem[];
  /** 円・整数 = items の amount 合計(税込) */
  totalAmount: number;
  /** 消費税合計(円・整数)。税フィールド導入前データは未設定 */
  taxAmount?: number;
  status: InvoiceStatus;
  /** 転換元の見積ID(見積→請求変換で生成された場合のみ) */
  quoteId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: string;
  /** 見積番号(事業内連番・作成時に採番)。連番導入前のデータは未設定 */
  quoteNumber?: string;
  customerId: string;
  projectId?: string;
  /** 見積発行日 YYYY-MM-DD */
  issueDate: DateString;
  /** 見積有効期限 YYYY-MM-DD */
  validUntil: DateString;
  items: InvoiceItem[];
  /** 円・整数 = items の amount 合計(税込) */
  totalAmount: number;
  /** 消費税合計(円・整数)。税フィールド導入前データは未設定 */
  taxAmount?: number;
  /** 帳票の備考欄に出す補足(任意) */
  notes?: string;
  status: QuoteStatus;
  /** 転換先の請求書ID(status=convertedのとき設定) */
  convertedInvoiceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  date: DateString;
  /** 円・整数・正数 */
  amount: number;
  transactionId?: string;
  createdAt: string;
}

/**
 * 取引先から受領した請求書(買掛)。
 * 支払は billPayments で消込し、支払合計が totalAmount に達すると
 * status が paid になる(入金消込の買掛版)。
 */
export interface Bill {
  id: string;
  /** 取引先名(支払先) */
  vendorName: string;
  /** 請求額(円・整数・正数・税込) */
  totalAmount: number;
  /** 受領日 YYYY-MM-DD */
  receivedDate: DateString;
  /** 支払期日 YYYY-MM-DD */
  dueDate: DateString;
  /** 摘要(任意) */
  description?: string;
  status: BillStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 受領請求書への支払(消込)。部分支払可、超過支払は不可。 */
export interface BillPayment {
  id: string;
  billId: string;
  /** 支払日 YYYY-MM-DD */
  date: DateString;
  /** 円・整数・正数 */
  amount: number;
  /** 対応する支出Transaction */
  transactionId?: string;
  createdAt: string;
}

export interface MonthlySummary {
  /** `yyyyMM` 形式のドキュメントID */
  month: string;
  totalIncome: number;
  totalExpense: number;
  /** 科目コードごとの収支 */
  accountBreakdown: Record<string, { income: number; expense: number }>;
  computedAt: string;
}

export interface RecurringTemplate {
  id: string;
  name: string;
  type: TransactionType;
  /** 勘定科目コード */
  account: string;
  counterparty: string;
  description: string;
  /** 円・整数・正数 */
  amount: number;
  /** 毎月の生成日(1-31)。その月に存在しない日は末日へ調整される */
  dayOfMonth: number;
  active: boolean;
  /** 最後に取引を生成した月(yyyyMM)。未生成は未設定 */
  lastGeneratedMonth?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 定期請求書テンプレート。間隔・開始日・終了条件(終了日または回数)を持ち、
 * 期日の来た月にドラフト請求書を自動生成する。
 * 定期取引(recurringTemplates)とは別コレクションで、生成物は invoices。
 */
export interface RecurringInvoiceTemplate {
  id: string;
  name: string;
  customerId: string;
  projectId?: string;
  /** 請求明細。登録時に正規化済み(amount=quantity*unitPrice・taxRate/taxAmount付与) */
  items: InvoiceItem[];
  /** 生成間隔(月・1-36)。1=毎月、3=3か月ごと、12=毎年。startDateの月が起点 */
  intervalMonths: number;
  /** 各生成月の発行日(1-31)。その月に存在しない日は末日へ調整される */
  dayOfMonth: number;
  /** この日以降の発行日のみ生成対象とする開始日 YYYY-MM-DD */
  startDate: DateString;
  /** この日を超える発行日は生成しない終了日 YYYY-MM-DD(任意) */
  endDate?: DateString;
  /** 生成する請求書の上限回数(任意)。generatedCount が達したら生成しない */
  maxOccurrences?: number;
  /** 支払期日 = 発行日 + dueDays 日後(0-366) */
  dueDays: number;
  active: boolean;
  /** これまでに生成した請求書の累計数 */
  generatedCount: number;
  /** 最後に生成処理を行った月(yyyyMM)。未処理は未設定 */
  lastGeneratedMonth?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FiscalPeriod {
  id: string;
  fiscalYear: number;
  startDate: DateString;
  endDate: DateString;
  status: FiscalPeriodStatus;
  closedAt?: string;
  closedBy?: string;
}

/** 減価償却方法。straightLine=定額法、decliningBalance=定率法(200%) */
export type DepreciationMethod = "straightLine" | "decliningBalance";

export type FixedAssetStatus = "active" | "disposed";

/**
 * 固定資産(減価償却資産)台帳。年度ごとの償却費は
 * domain/depreciation.ts が取得価額・耐用年数・取得日から再計算する。
 * 経費計上済み年度は lastBookedFiscalYear で管理し二重計上を防ぐ。
 */
export interface FixedAsset {
  id: string;
  name: string;
  /** 取得日 YYYY-MM-DD */
  acquiredDate: DateString;
  /** 取得価額(円・整数・正数) */
  acquisitionCost: number;
  /** 耐用年数(年・整数) */
  usefulLifeYears: number;
  method: DepreciationMethod;
  /** 事業使用割合(%・0-100整数)。償却費の経費計上額に適用する家事按分 */
  businessRatio: number;
  status: FixedAssetStatus;
  /** 除却日 YYYY-MM-DD。status=disposed のとき設定 */
  disposedDate?: DateString;
  /** 最後に償却費を経費計上した会計年度(開始年)。未計上は未設定 */
  lastBookedFiscalYear?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 棚卸品目マスタ。品目名・単位・標準単価を保持し、
 * 年度別の期末棚卸カウント(inventoryCounts)の行を構成する。
 */
export interface InventoryItem {
  id: string;
  /** 品目名 */
  name: string;
  /** 単位(個・本・kg 等の任意文字列) */
  unit: string;
  /** 標準単価(円・整数・0以上)。カウント時の評価単価の初期値 */
  standardUnitPrice: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 期末棚卸カウントの明細行。
 * name/unit は保存時点の品目マスタからのスナップショット
 * (棚卸表は期末確定資料のため、後の品目変更・削除で内容が変わらないようにする)。
 */
export interface InventoryCountLine {
  itemId: string;
  /** 保存時点の品目名スナップショット */
  name: string;
  /** 保存時点の単位スナップショット */
  unit: string;
  /** 実在庫数量(0以上。単位によっては小数可) */
  quantity: number;
  /** 評価単価(円・整数・0以上)。標準単価を初期値として棚卸時に確定 */
  unitPrice: number;
}

/**
 * 年度別の期末棚卸カウント。ドキュメントIDは `fy{fiscalYear}`
 * (fiscalPeriods と同じ決定的採番)。期末棚卸高は lines の
 * quantity×unitPrice 合計として都度計算する(保存しない)。
 */
export interface InventoryCount {
  /** `fy{fiscalYear}` 形式のドキュメントID */
  id: string;
  /** 会計年度の開始年 */
  fiscalYear: number;
  lines: InventoryCountLine[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  action: AuditAction;
  /** 対象ドキュメントのパス。内容スナップショットは保存しない */
  targetPath: string;
  createdAt: string;
}
