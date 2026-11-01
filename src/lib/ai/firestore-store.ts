import {
  FieldValue,
  Timestamp,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  type AISuggestionStore,
  type SuggestionListFilter,
} from "./store";
import type {
  AISuggestion,
  AuditLogEntry,
  NewAISuggestion,
} from "./types";

// 複合インデックスを増やさないため、クエリは単一フィールドの等価条件までに留め、
// 残りの絞り込みと並び替えはメモリで行う。走査量はこの件数で打ち切る。
const LIST_SCAN_LIMIT = 200;

/**
 * businesses/{businessId}/aiSuggestions へのAdmin SDK実装。
 * aiSuggestionsの書き込みはサーバーサイドのみ(Security Rulesでクライアント拒否)。
 * 個人情報・証憑内容をログに出力しない。
 */
export class FirestoreSuggestionStore implements AISuggestionStore {
  constructor(private readonly db: Firestore) {}

  private collection(businessId: string) {
    return this.db
      .collection("businesses")
      .doc(businessId)
      .collection("aiSuggestions");
  }

  async create(businessId: string, doc: NewAISuggestion): Promise<string> {
    const ref = this.collection(businessId).doc();
    await ref.set(serialize(doc));
    return ref.id;
  }

  async get(businessId: string, id: string): Promise<AISuggestion | null> {
    const snap = await this.collection(businessId).doc(id).get();
    if (!snap.exists) return null;
    return deserialize(snap.id, snap.data() as Record<string, unknown>);
  }

  async list(
    businessId: string,
    filter: SuggestionListFilter = {},
  ): Promise<AISuggestion[]> {
    // 最も絞り込める条件だけをFirestoreのwhereにし、他はメモリで適用する
    let query: Query = this.collection(businessId);
    if (filter.targetId) {
      query = query.where("target.id", "==", filter.targetId);
    } else if (filter.status) {
      query = query.where("status", "==", filter.status);
    }
    const snap = await query.limit(LIST_SCAN_LIMIT).get();
    const items = snap.docs
      .map((d) => deserialize(d.id, d.data() as Record<string, unknown>))
      .filter(
        (s) =>
          (!filter.targetType || s.target.type === filter.targetType) &&
          (!filter.targetId || s.target.id === filter.targetId) &&
          (!filter.kind || s.kind === filter.kind) &&
          (!filter.status || s.status === filter.status),
      );
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const limit = Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    return items.slice(0, limit);
  }

  async update(
    businessId: string,
    id: string,
    patch: Partial<Omit<AISuggestion, "id" | "businessId">>,
  ): Promise<void> {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      data[key] = value instanceof Date ? Timestamp.fromDate(value) : value;
    }
    await this.collection(businessId).doc(id).update(data);
  }

  async appendAuditLog(
    businessId: string,
    entry: AuditLogEntry,
  ): Promise<void> {
    await this.db
      .collection("businesses")
      .doc(businessId)
      .collection("auditLogs")
      .add({
        actorUid: entry.actorUid,
        action: entry.action,
        targetPath: entry.targetPath,
        createdAt: Timestamp.fromDate(entry.createdAt),
        serverTimestamp: FieldValue.serverTimestamp(),
      });
  }
}

function serialize(doc: NewAISuggestion): Record<string, unknown> {
  return {
    ...doc,
    createdAt: Timestamp.fromDate(doc.createdAt),
    updatedAt: Timestamp.fromDate(doc.updatedAt),
    decidedAt: doc.decidedAt ? Timestamp.fromDate(doc.decidedAt) : null,
  };
}

function deserialize(id: string, data: Record<string, unknown>): AISuggestion {
  return {
    ...(data as Omit<AISuggestion, "id" | "createdAt" | "updatedAt" | "decidedAt">),
    id,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    decidedAt: data.decidedAt ? toDate(data.decidedAt) : null,
  };
}

function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return new Date(0);
}
