import { getAdminDb } from "@/lib/firebase/admin";
import { FirestoreAccountingStore } from "@/lib/accounting/store/firestore";
import type { AccountingStore } from "@/lib/accounting/store/types";

/**
 * サーバーサイドのドメインストア。
 * Admin SDK 経由のため Security Rules をバイパスする。
 * 必ず session.ts の requireMembership / requireRole で認可してから使うこと。
 */
let store: FirestoreAccountingStore | undefined;

export function getStore(): AccountingStore {
  store ??= new FirestoreAccountingStore(getAdminDb());
  return store;
}
