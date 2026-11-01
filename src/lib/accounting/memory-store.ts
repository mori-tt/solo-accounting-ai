import { DomainError } from "./domain/errors";
import type {
  AccountingStore,
  CollectionName,
  EntityByCollection,
  IdempotentCollection,
} from "./store";

type Bucket = Map<string, unknown>;
type DataMap = Map<string, Map<string, Bucket>>;

export class InMemoryAccountingStore implements AccountingStore {
  private data: DataMap;

  constructor(data?: DataMap) {
    this.data = data ?? new Map();
  }

  private bucket(
    businessId: string,
    collection: string,
    create: boolean,
  ): Bucket {
    let byCollection = this.data.get(businessId);
    if (!byCollection) {
      if (!create) return new Map();
      byCollection = new Map();
      this.data.set(businessId, byCollection);
    }
    let bucket = byCollection.get(collection);
    if (!bucket) {
      if (!create) return new Map();
      bucket = new Map();
      byCollection.set(collection, bucket);
    }
    return bucket;
  }

  async get<C extends CollectionName>(
    businessId: string,
    collection: C,
    id: string,
  ): Promise<EntityByCollection[C] | null> {
    const entity = this.bucket(businessId, collection, false).get(id);
    return entity
      ? (structuredClone(entity) as EntityByCollection[C])
      : null;
  }

  async list<C extends CollectionName>(
    businessId: string,
    collection: C,
  ): Promise<EntityByCollection[C][]> {
    return [...this.bucket(businessId, collection, false).values()].map(
      (entity) => structuredClone(entity) as EntityByCollection[C],
    );
  }

  async create<C extends CollectionName>(
    businessId: string,
    collection: C,
    id: string,
    entity: EntityByCollection[C],
  ): Promise<void> {
    const bucket = this.bucket(businessId, collection, true);
    if (bucket.has(id)) {
      throw new DomainError(
        "ALREADY_EXISTS",
        `${collection}/${id} already exists`,
      );
    }
    bucket.set(id, structuredClone(entity));
  }

  async update<C extends CollectionName>(
    businessId: string,
    collection: C,
    id: string,
    patch: Partial<EntityByCollection[C]>,
  ): Promise<void> {
    const bucket = this.bucket(businessId, collection, false);
    const existing = bucket.get(id);
    if (!existing) {
      throw new DomainError("NOT_FOUND", `${collection}/${id} not found`);
    }
    bucket.set(id, {
      ...(existing as Record<string, unknown>),
      ...(structuredClone(patch) as Record<string, unknown>),
    });
  }

  async remove<C extends CollectionName>(
    businessId: string,
    collection: C,
    id: string,
  ): Promise<void> {
    const bucket = this.bucket(businessId, collection, false);
    if (!bucket.delete(id)) {
      throw new DomainError("NOT_FOUND", `${collection}/${id} not found`);
    }
  }

  async findByIdempotencyKey(
    businessId: string,
    collection: IdempotentCollection,
    key: string,
  ): Promise<string | null> {
    for (const [id, entity] of this.bucket(businessId, collection, false)) {
      if (
        (entity as { idempotencyKey?: string | null }).idempotencyKey === key
      ) {
        return id;
      }
    }
    return null;
  }

  async runInTransaction<T>(
    fn: (store: AccountingStore) => Promise<T>,
  ): Promise<T> {
    const working = new InMemoryAccountingStore(structuredClone(this.data));
    const result = await fn(working);
    this.data = working.data;
    return result;
  }
}
