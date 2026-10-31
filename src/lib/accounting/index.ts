/**
 * 経理ドメイン層。
 * 会計ロジックはすべてここに置き、UI・API層には書かない。
 * 永続化は AccountingStore ポート経由
 * (本番: FirestoreAccountingStore / テスト: MemoryStore)。
 */

export * from "./types";
export * from "./errors";
export * from "./money";
export * from "./dates";
export * from "./audit";
export * from "./suggestions";
export * from "./store/types";
export { MemoryStore } from "./store/memory";
export { FirestoreAccountingStore } from "./store/firestore";
export type { ActorContext } from "./services/common";
export { registerBusiness } from "./services/business";
export type { RegisterBusinessInput } from "./services/business";
export {
  registerTransaction,
  confirmTransaction,
} from "./services/transactions";
export type { RegisterTransactionInput } from "./services/transactions";
export {
  registerExpense,
  markExpensePaid,
  findUnpaidExpenses,
} from "./services/expenses";
export type {
  RegisterExpenseInput,
  UnpaidExpense,
} from "./services/expenses";
export {
  registerCustomer,
  registerProject,
  registerInvoice,
  issueInvoice,
  registerPayment,
  findUnpaidInvoices,
  refreshOverdueInvoices,
} from "./services/sales";
export type {
  RegisterCustomerInput,
  RegisterProjectInput,
  RegisterInvoiceInput,
  RegisterPaymentInput,
  UnpaidInvoice,
} from "./services/sales";
export {
  registerReceipt,
  linkReceiptToTransaction,
  archiveReceipt,
} from "./services/receipts";
export type { RegisterReceiptInput } from "./services/receipts";
export {
  recordTransactionSuggestion,
  approveTransactionSuggestion,
  rejectTransactionSuggestion,
  recordReceiptSuggestion,
  decideReceiptSuggestion,
} from "./services/aiSuggestions";
export type { RecordSuggestionInput } from "./services/aiSuggestions";
export {
  computeMonthlySummary,
  recomputeMonthlySummary,
} from "./services/monthlySummary";
export {
  ensureFiscalPeriodForDate,
  closingChecklist,
  closeFiscalPeriod,
  fiscalPeriodIdOf,
} from "./services/periods";
export type { ClosingChecklist } from "./services/periods";
