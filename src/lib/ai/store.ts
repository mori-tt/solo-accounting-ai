import type {
  AISuggestion,
  AuditLogEntry,
  NewAISuggestion,
  SuggestionKind,
  SuggestionStatus,
  SuggestionTargetType,
} from "./types";

/** list の既定件数 */
export const DEFAULT_LIST_LIMIT = 50;
/** list の最大件数(これを超えるlimit指定は丸める) */
export const MAX_LIST_LIMIT = 100;

/** 提案一覧の絞り込み条件。未指定の項目は絞り込まない */
export interface SuggestionListFilter {
  targetType?: SuggestionTargetType;
  targetId?: string;
  kind?: SuggestionKind;
  status?: SuggestionStatus;
  /** 返却件数の上限(既定・最大とも呼び出し側で制御) */
  limit?: number;
}

/**
 * AI提案の永続化抽象化。
 * 本番はFirestore実装(firestore-store.ts)、テストはInMemorySuggestionStore。
 */
export interface AISuggestionStore {
  create(businessId: string, doc: NewAISuggestion): Promise<string>;
  get(businessId: string, id: string): Promise<AISuggestion | null>;
  /**
   * 提案一覧を createdAt 降順で返す。
   * filter未指定時はbusinessId内の全件(limitの既定値は実装側で決める)。
   */
  list(
    businessId: string,
    filter?: SuggestionListFilter,
  ): Promise<AISuggestion[]>;
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

  async list(
    businessId: string,
    filter: SuggestionListFilter = {},
  ): Promise<AISuggestion[]> {
    const items = [...this.suggestions.values()].filter(
      (s) =>
        s.businessId === businessId &&
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
