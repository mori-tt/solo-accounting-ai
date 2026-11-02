import { describe, expect, it } from "vitest";
import { effectiveOwnerUids, roleAtLeast, toMemberRole } from "./member-role";

describe("toMemberRole", () => {
  it("有効なロールはそのまま返す", () => {
    expect(toMemberRole("owner")).toBe("owner");
    expect(toMemberRole("editor")).toBe("editor");
    expect(toMemberRole("viewer")).toBe("viewer");
  });

  it("未知の値は undefined を返す", () => {
    // memberドキュメントの role が壊れていても権限チェックを通過させない
    // (ROLE_RANK[未知値] === undefined で比較をすり抜ける経路を遮断)
    expect(toMemberRole("superadmin")).toBeUndefined();
    expect(toMemberRole("Owner")).toBeUndefined();
    expect(toMemberRole("")).toBeUndefined();
    expect(toMemberRole(undefined)).toBeUndefined();
    expect(toMemberRole(null)).toBeUndefined();
    expect(toMemberRole(1)).toBeUndefined();
    expect(toMemberRole({ role: "owner" })).toBeUndefined();
  });
});

describe("roleAtLeast", () => {
  it("上位ロールは下位の要求を満たす", () => {
    expect(roleAtLeast("owner", "viewer")).toBe(true);
    expect(roleAtLeast("owner", "editor")).toBe(true);
    expect(roleAtLeast("owner", "owner")).toBe(true);
    expect(roleAtLeast("editor", "viewer")).toBe(true);
    expect(roleAtLeast("editor", "editor")).toBe(true);
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
  });

  it("下位ロールは上位の要求を満たさない", () => {
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast("viewer", "owner")).toBe(false);
    expect(roleAtLeast("editor", "owner")).toBe(false);
  });
});

describe("effectiveOwnerUids", () => {
  it("memberドキュメントのownerを列挙する", () => {
    const roles = new Map([
      ["a", "owner"],
      ["b", "editor"],
      ["c", "viewer"],
    ]);
    expect(effectiveOwnerUids(roles, undefined)).toEqual(new Set(["a"]));
  });

  it("memberドキュメントが無いownerUidはフォールバックでownerになる", () => {
    const roles = new Map([["a", "editor"]]);
    expect(effectiveOwnerUids(roles, "owner-x")).toEqual(new Set(["owner-x"]));
  });

  it("ownerUidに非ownerのmemberドキュメントがあるとフォールバックしない", () => {
    // ownerUidユーザーのmemberドキュメントをviewerへ書き換えると
    // owner権限を失う(requireMembershipと同じ判定)
    const roles = new Map([
      ["a", "owner"],
      ["owner-x", "viewer"],
    ]);
    expect(effectiveOwnerUids(roles, "owner-x")).toEqual(new Set(["a"]));
  });

  it("ownerUidのroleが不正な値ならフォールバックする", () => {
    const roles = new Map([["owner-x", "superadmin"]]);
    expect(effectiveOwnerUids(roles, "owner-x")).toEqual(new Set(["owner-x"]));
  });

  it("ownerUid未指定・ownerメンバーなしなら空になる", () => {
    const roles = new Map([["a", "viewer"]]);
    expect(effectiveOwnerUids(roles, undefined).size).toBe(0);
  });
});
