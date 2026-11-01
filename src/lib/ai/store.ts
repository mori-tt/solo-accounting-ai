import type {
  AISuggestion,
  AuditLogEntry,
  NewAISuggestion,
} from "./types";

/**
 * AI提案の永続化抽象化。
 * 本番はFirestore実装(firestore-store.ts)、テストはInMemorySuggestionStore。
 */
export interface AISuggestionStore {
  create(businessId: string, doc: NewAISuggestion): Promise<string>;
  get(businessId: string, id: string): Promise<AISuggestion | null>;
  update(
    businessId: string,
    id: string,
    patch: Partial<Omit<AISuggestion, "id" | "businessId">>,
  ): Promise<void>;
  appendAuditLog(businessId: string, entry: AuditLogEntry): Promise<void>;
}

/** テスト・開発用のインメモリ実装 */
export class InMemorySuggestionStore implements AISuggestionStore {
  private suggestions = new Map<string, AISuggestion>();
  private auditLogs = new Map<string, AuditLogEntry[]>();
  private counter = 0;

  async create(businessId: string, doc: NewAISuggestion): Promise<string> {
    const id = `sug-${++this.counter}`;
    this.suggestions.set(this.key(businessId, id), { ...doc, id });
    return id;
  }

  async get(businessId: string, id: string): Promise<AISuggestion | null> {
    return this.suggestions.get(this.key(businessId, id)) ?? null;
  }

  async update(
    businessId: string,
    id: string,
    patch: Partial<Omit<AISuggestion, "id" | "businessId">>,
  ): Promise<void> {
    const key = this.key(businessId, id);
    const current = this.suggestions.get(key);
    if (!current) throw new Error(`suggestion not found: ${id}`);
    this.suggestions.set(key, { ...current, ...patch });
  }

  async appendAuditLog(
    businessId: string,
    entry: AuditLogEntry,
  ): Promise<void> {
    const list = this.auditLogs.get(businessId) ?? [];
    list.push(entry);
    this.auditLogs.set(businessId, list);
  }

  auditLogEntries(businessId: string): AuditLogEntry[] {
    return this.auditLogs.get(businessId) ?? [];
  }

  private key(businessId: string, id: string): string {
    return `${businessId}/${id}`;
  }
}
