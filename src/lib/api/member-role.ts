import type { MemberRole } from "@/lib/accounting/types";

/** memberドキュメントの role として有効な値 */
export const MEMBER_ROLES: readonly MemberRole[] = [
  "viewer",
  "editor",
  "owner",
];

const ROLE_RANK: Record<MemberRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

/**
 * 生データ(Firestoreのmemberドキュメント等)の role を検証する。
 * "owner"/"editor"/"viewer" 以外(未設定・typo・改ざん値)は undefined を返す。
 * 呼び出し側は undefined を非メンバー相当として扱うこと:
 * `ROLE_RANK[未知値]` は undefined になり比較演算をすり抜けるため。
 */
export function toMemberRole(value: unknown): MemberRole | undefined {
  return MEMBER_ROLES.includes(value as MemberRole)
    ? (value as MemberRole)
    : undefined;
}

/** role が minRole 以上なら true */
export function roleAtLeast(role: MemberRole, minRole: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/**
 * 実効ownerのuid集合を返す。
 * - memberドキュメントの role === 'owner' のuid
 * - memberドキュメントが無い・role不正な場合の business.ownerUid
 *   (requireMembership が ownerUid へフォールバック付与するowner権限と同じ判定)
 */
export function effectiveOwnerUids(
  memberRoles: ReadonlyMap<string, unknown>,
  ownerUid: string | undefined,
): Set<string> {
  const owners = new Set<string>();
  for (const [uid, role] of memberRoles) {
    if (role === "owner") owners.add(uid);
  }
  if (
    ownerUid !== undefined &&
    toMemberRole(memberRoles.get(ownerUid)) === undefined
  ) {
    owners.add(ownerUid);
  }
  return owners;
}
