import { describe, expect, it } from "vitest";
import {
  findExistingMatches,
  findInFileDuplicatePartners,
  normalizeBankDate,
  parseBankCsv,
  shiftDate,
  type BankCsvRow,
} from "./bank-csv";

const BASIC_HEADER = "日付,摘要,出金額,入金額,残高";

describe("parseBankCsv", () => {
  it("日付/摘要/出金額/入金額/残高 の基本形をパースする", () => {
    const { rows, fileError, columnMode } = parseBankCsv(
      `${BASIC_HEADER}\n` +
        "2026/11/01,コンビニ支払い,1200,,998800\n" +
        "2026/11/02,売上入金,,98000,1096800",
    );
    expect(fileError).toBeUndefined();
    expect(columnMode).toBe("split");
    expect(rows).toHaveLength(2);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[0].candidate).toEqual({
      date: "2026-11-01",
      description: "コンビニ支払い",
      amount: 1200,
      type: "expense",
    });
    expect(rows[1].candidate).toEqual({
      date: "2026-11-02",
      description: "売上入金",
      amount: 98000,
      type: "income",
    });
    expect(rows[0].values.balance).toBe("998800");
  });

  it("列名のゆらぎ(メガバンク風)を別名で吸収する", () => {
    const { rows, detectedColumns } = parseBankCsv(
      "取引日,お取引内容,お支払い金額,お預かり金額,差引残高\n" +
        "2026/11/01,カード引落,5000,,100000",
    );
    expect(rows[0].candidate?.type).toBe("expense");
    expect(rows[0].candidate?.amount).toBe(5000);
    expect(detectedColumns?.date).toBe("取引日");
    expect(detectedColumns?.withdrawal).toBe("お支払い金額");
  });

  it("列名のゆらぎ(ゆうちょ風: 払出金額/預入金額)を吸収する", () => {
    const { rows } = parseBankCsv(
      "年月日,摘要,払出金額,預入金額,残高\n2026-11-01,振込受取,,30000,30000",
    );
    expect(rows[0].candidate).toMatchObject({ type: "income", amount: 30000 });
  });

  it("列順の入れ替え・余分な列・括弧付き列名を許容する", () => {
    const { rows, columnMode } = parseBankCsv(
      "摘要,入金額(円),日付,メモ,出金額(円),残高(円)\n" +
        "振込,7000,2026/11/03,自由メモ,,7000",
    );
    expect(columnMode).toBe("split");
    expect(rows[0].candidate).toMatchObject({
      date: "2026-11-03",
      description: "振込",
      amount: 7000,
      type: "income",
    });
  });

  it("ヘッダー前の口座情報行を読み飛ばす", () => {
    const { rows } = parseBankCsv(
      "口座番号,1234567\n利用明細,,,,\n" +
        `${BASIC_HEADER}\n2026/11/01,支払い,3000,,97000`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(4);
    expect(rows[0].candidate?.amount).toBe(3000);
  });

  it("単一金額列のCSV(カード明細風)は支出として解釈する", () => {
    const { rows, columnMode } = parseBankCsv(
      "利用日,利用店名・商品名,利用者,支払方法,利用金額,当月お支払い金額\n" +
        "2026/10/15,ショップX,本人,1回払い,4500,4500",
    );
    expect(columnMode).toBe("single");
    expect(rows[0].candidate).toEqual({
      date: "2026-10-15",
      description: "ショップX",
      amount: 4500,
      type: "expense",
    });
  });

  it("日付の各種表記を正規化する", () => {
    const { rows } = parseBankCsv(
      `${BASIC_HEADER}\n` +
        "2026/1/5,A,100,,0\n" +
        "2026-11-02,B,100,,0\n" +
        "2026.11.3,C,100,,0\n" +
        "20261104,D,100,,0\n" +
        "2026年11月5日,E,100,,0\n" +
        "R8.11.6,F,100,,0\n" +
        "令和8年11月7日,G,100,,0\n" +
        "令和元年11月8日,H,100,,0\n" +
        "2026/11/09(月),I,100,,0",
    );
    const dates = rows.map((r) => r.candidate?.date);
    expect(dates).toEqual([
      "2026-01-05",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2019-11-08",
      "2026-11-09",
    ]);
  });

  it("金額の全角・円記号・桁区切りを正規化する", () => {
    const { rows } = parseBankCsv(
      `${BASIC_HEADER}\n` +
        '2026/11/01,A,"12,000",,0\n' +
        "2026/11/02,B,￥３０００,,0\n" +
        "2026/11/03,C,,15000円,0",
    );
    expect(rows[0].candidate?.amount).toBe(12000);
    expect(rows[1].candidate?.amount).toBe(3000);
    expect(rows[2].candidate?.amount).toBe(15000);
  });

  it("出金・入金が両方空の行はエラーではなく対象外にする", () => {
    const { rows } = parseBankCsv(
      `${BASIC_HEADER}\n` +
        "2026/04/01,繰越,,,500000\n" +
        "2026/04/02,支払い,3000,,497000",
    );
    expect(rows[0].candidate).toBeUndefined();
    expect(rows[0].skippedReason).toBeDefined();
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].candidate?.amount).toBe(3000);
  });

  it("出金・入金の両方に値がある行はエラーにする", () => {
    const { rows } = parseBankCsv(
      `${BASIC_HEADER}\n2026/11/01,謎の行,100,200,0`,
    );
    expect(rows[0].candidate).toBeUndefined();
    expect(rows[0].errors[0]).toContain("両方");
  });

  it("負の金額・解釈不能な金額・不正日付はエラーにする", () => {
    const { rows } = parseBankCsv(
      `${BASIC_HEADER}\n` +
        "2026/11/01,△表記,△300,,0\n" +
        "2026/11/02,カッコ表記,,(300),0\n" +
        "2026/11/03,壊れた金額,abc,,0\n" +
        "2026/13/40,不正日付,100,,0\n" +
        ",空日付,100,,0",
    );
    expect(rows[0].errors[0]).toContain("負の金額");
    expect(rows[1].errors[0]).toContain("負の金額");
    expect(rows[2].errors[0]).toContain("出金額");
    expect(rows[3].errors[0]).toContain("日付");
    expect(rows[4].errors[0]).toContain("日付");
    expect(rows.every((r) => r.candidate === undefined)).toBe(true);
  });

  it("摘要500文字超はエラーにする", () => {
    const { rows } = parseBankCsv(
      `${BASIC_HEADER}\n2026/11/01,${"あ".repeat(501)},100,,0`,
    );
    expect(rows[0].errors[0]).toContain("500");
  });

  it("空行と末尾改行を吸収する", () => {
    const { rows } = parseBankCsv(
      `${BASIC_HEADER}\n2026/11/01,A,100,,0\n\n,,,\n`,
    );
    expect(rows).toHaveLength(1);
  });

  it("ヘッダー行が見つからない場合はファイルエラーにする", () => {
    const r = parseBankCsv("A,B,C\n1,2,3");
    expect(r.fileError).toContain("ヘッダー");
    expect(r.rows).toEqual([]);
  });

  it("摘要列がない場合はファイルエラーにする", () => {
    const r = parseBankCsv("日付,出金額,入金額\n2026/11/01,100,");
    expect(r.fileError).toContain("摘要");
  });

  it("データ行がない場合はファイルエラーにする", () => {
    expect(parseBankCsv("").fileError).toBeDefined();
    expect(parseBankCsv(BASIC_HEADER).fileError).toBeDefined();
  });
});

describe("normalizeBankDate", () => {
  it("受理する表記を正規化する", () => {
    expect(normalizeBankDate("2026/11/2")).toBe("2026-11-02");
    expect(normalizeBankDate(" 2026-11-02 ")).toBe("2026-11-02");
    expect(normalizeBankDate("Ｒ６.１１.２")).toBeUndefined(); // 全角Rは対象外
    expect(normalizeBankDate("R6.11.2")).toBe("2024-11-02");
    expect(normalizeBankDate("H31.4.30")).toBe("2019-04-30");
    expect(normalizeBankDate("令和6年11月2日")).toBe("2024-11-02");
    expect(normalizeBankDate("平成31年1月7日")).toBe("2019-01-07");
    expect(normalizeBankDate("２０２６年１１月２日")).toBe("2026-11-02");
    expect(normalizeBankDate("2026/11/02 00:00:00")).toBe("2026-11-02");
  });

  it("存在しない日付・解釈不能な表記は undefined", () => {
    expect(normalizeBankDate("2026-02-30")).toBeUndefined();
    expect(normalizeBankDate("2026-13-01")).toBeUndefined();
    expect(normalizeBankDate("11/02")).toBeUndefined(); // 年なしは推測しない
    expect(normalizeBankDate("")).toBeUndefined();
    expect(normalizeBankDate("不明")).toBeUndefined();
  });
});

describe("shiftDate", () => {
  it("日付を前後にずらす(月またぎ含む)", () => {
    expect(shiftDate("2026-11-01", -3)).toBe("2026-10-29");
    expect(shiftDate("2026-11-30", 3)).toBe("2026-12-03");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("findExistingMatches", () => {
  const existing = [
    { id: "a", date: "2026-11-01", amount: 1200 },
    { id: "b", date: "2026-11-04", amount: 1200 },
    { id: "c", date: "2026-11-10", amount: 1200 },
    { id: "d", date: "2026-11-01", amount: 999 },
  ];

  it("同金額・日付差3日以内を日付差順で返す", () => {
    const matches = findExistingMatches(
      { date: "2026-11-02", amount: 1200 },
      existing,
    );
    expect(matches.map((m) => m.transaction.id)).toEqual(["a", "b"]);
    expect(matches[0].dayDiff).toBe(1);
    expect(matches[1].dayDiff).toBe(2);
  });

  it("金額が違う取引は除外する", () => {
    const matches = findExistingMatches(
      { date: "2026-11-01", amount: 999 },
      existing,
    );
    expect(matches.map((m) => m.transaction.id)).toEqual(["d"]);
  });

  it("候補がなければ空配列", () => {
    expect(
      findExistingMatches({ date: "2027-01-01", amount: 5 }, existing),
    ).toEqual([]);
  });
});

describe("findInFileDuplicatePartners", () => {
  const row = (
    rowNumber: number,
    candidate?: { date: string; description: string; amount: number; type: "income" | "expense" },
  ): BankCsvRow => ({
    rowNumber,
    values: {
      date: "",
      description: "",
      withdrawal: "",
      deposit: "",
      balance: "",
    },
    candidate,
    errors: [],
  });

  it("日付・種別・金額が一致する行同士をペアにする", () => {
    const partners = findInFileDuplicatePartners([
      row(2, { date: "2026-11-01", description: "a", amount: 100, type: "expense" }),
      row(3, { date: "2026-11-01", description: "b", amount: 100, type: "expense" }),
      row(4, { date: "2026-11-01", description: "c", amount: 100, type: "income" }),
      row(5, { date: "2026-11-02", description: "d", amount: 100, type: "expense" }),
    ]);
    expect(partners.get(2)).toEqual([3]);
    expect(partners.get(3)).toEqual([2]);
    expect(partners.has(4)).toBe(false); // typeが違うので重複ではない
    expect(partners.has(5)).toBe(false); // 日付が違うので重複ではない
  });

  it("候補化できない行は対象外にする", () => {
    const partners = findInFileDuplicatePartners([
      row(2),
      row(3),
    ]);
    expect(partners.size).toBe(0);
  });
});
