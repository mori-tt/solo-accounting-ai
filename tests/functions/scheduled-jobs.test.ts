import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import {
  backupObjectPath,
  errorMessage,
  lastBackupIso,
} from "../../functions/src/backup-utils";
import {
  SCHEDULE_TIME_ZONE,
  todayInTimeZone,
} from "../../functions/src/time";

describe("todayInTimeZone", () => {
  it("UTCと日付がずれる境界でJST基準の日付を返す", () => {
    // 2026-11-01 00:30 JST = 2026-10-31 15:30 UTC
    const now = new Date("2026-10-31T15:30:00.000Z");
    expect(todayInTimeZone(SCHEDULE_TIME_ZONE, now)).toBe("2026-11-01");
  });

  it("JSTで月末前の日付はUTC当日ではなくJST当日を返す", () => {
    // 2026-10-31 23:30 JST = 2026-10-31 14:30 UTC
    const now = new Date("2026-10-31T14:30:00.000Z");
    expect(todayInTimeZone(SCHEDULE_TIME_ZONE, now)).toBe("2026-10-31");
  });
});

describe("backupObjectPath", () => {
  it("backups/{businessId} 配下に日付別JSONパスを返す", () => {
    expect(backupObjectPath("biz1", "2026-11-02")).toBe(
      "backups/biz1/backup-2026-11-02.json",
    );
  });
});

describe("lastBackupIso", () => {
  const iso = "2026-10-01T00:00:00.000Z";

  it("TimestampをISO文字列へ変換する", () => {
    const data = { lastBackupAt: Timestamp.fromDate(new Date(iso)) };
    expect(lastBackupIso(data)).toBe(iso);
  });

  it("文字列値はそのまま返す", () => {
    expect(lastBackupIso({ lastBackupAt: iso })).toBe(iso);
  });

  it("未設定・非オブジェクト・不正値はundefined(未取得扱い)", () => {
    expect(lastBackupIso({})).toBeUndefined();
    expect(lastBackupIso(null)).toBeUndefined();
    expect(lastBackupIso({ lastBackupAt: 123 })).toBeUndefined();
  });
});

describe("errorMessage", () => {
  it("Errorはmessage、それ以外は文字列化する", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});
