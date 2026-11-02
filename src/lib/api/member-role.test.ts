import { describe, expect, it } from "vitest";
import { roleAtLeast, toMemberRole } from "./member-role";

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
