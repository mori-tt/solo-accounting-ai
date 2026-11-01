import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import type { AISuggestionStore } from "./store";
import type {
  AISuggestion,
  AuditLogEntry,
  NewAISuggestion,
} from "./types";

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
