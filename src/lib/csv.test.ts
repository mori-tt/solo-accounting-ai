import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/accounting/types";
import { getAccountOptions } from "./accounts";
import {
  buildTransactionsCsv,
  decodeCsvBytes,
  parseCsv,
  parseTransactionsCsv,
  serializeCsv,
  TRANSACTION_CSV_HEADER,
} from "./csv";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("serializeCsv", () => {
  it("単純な行をそのまま出力する", () => {
    expect(
      serializeCsv([
        ["a", "b", "c"],
        ["1", "2", "3"],
      ]),
    ).toBe("a,b,c\r\n1,2,3");
  });

  it("カンマ・ダブルクォート・改行を含むフィールドをクォートする", () => {
    expect(serializeCsv([["a,b", 'c"d', "e\nf", "g\r\nh"]])).toBe(
      '"a,b","c""d","e\nf","g\r\nh"',
    );
  });

  it("クォートのみ・空フィールドを正しく処理する", () => {
    expect(serializeCsv([[""], ['"'], [" "]])).toBe('\r\n""""\r\n ');
  });
});

describe("parseCsv", () => {
  it("基本形をパースする", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("CRLFとLFを受理し末尾改行で空行を作らない", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
  });

  it("クォート内の改行・カンマ・エスケープクォートを処理する", () => {
    expect(parseCsv('"x\ny","a,b","q""w"')).toEqual([["x\ny", "a,b", 'q"w']]);
  });

  it("serializeCsv とラウンドトリップする", () => {
    const rows = [
      ["日付", "種別", "摘要"],
      ["2026-11-01", "支出", '説明,に"改行\n含む"'],
      ["", "", ""],
    ];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });

  it("先頭のBOMを除去する", () => {
    expect(parseCsv("\uFEFFa,b")).toEqual([["a", "b"]]);
  });

  it("空文字列と空行を処理する", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a\n\n")).toEqual([["a"], [""]]);
  });
});

describe("decodeCsvBytes", () => {
  it("UTF-8(BOMなし)をutf-8として解釈する", () => {
    const { text, encoding } = decodeCsvBytes(utf8("日付,種別"));
    expect(encoding).toBe("utf-8");
    expect(text).toBe("日付,種別");
  });

  it("UTF-8 BOMを除去する", () => {
    const { text, encoding } = decodeCsvBytes(
      new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("a,b")]),
    );
    expect(encoding).toBe("utf-8");
    expect(text).toBe("a,b");
  });

  it("UTF-16 BOMを検出する", () => {
    const le = decodeCsvBytes(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]));
    expect(le.encoding).toBe("utf-16le");
    expect(le.text).toBe("ab");
    const be = decodeCsvBytes(new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0x62]));
    expect(be.encoding).toBe("utf-16be");
    expect(be.text).toBe("ab");
  });

  it("UTF-8で解釈不能なバイト列をShift_JISとして解釈する", () => {
    // "日付" のShift_JISバイト列
    const { text, encoding } = decodeCsvBytes(
      new Uint8Array([0x93, 0xfa, 0x95, 0x74]),
    );
    expect(encoding).toBe("shift_jis");
    expect(text).toBe("日付");
  });

  it("ASCIIのみの入力はutf-8とする", () => {
    expect(decodeCsvBytes(utf8("a,b,c")).encoding).toBe("utf-8");
  });
});

const transactionFixture: Transaction = {
  id: "t1",
  type: "expense",
  date: "2026-11-01",
  amount: 12000,
  account: "supplies",
  counterparty: "〇〇商店",
  description: "備品,購入",
  receiptIds: [],
  status: "draft",
  createdBy: "u1",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

describe("buildTransactionsCsv", () => {
  it("ヘッダー+取引行を定義列で出力する", () => {
    const csv = buildTransactionsCsv([
      transactionFixture,
      { ...transactionFixture, id: "t2", type: "income", account: "sales", status: "confirmed" },
      { ...transactionFixture, id: "t3", type: "transfer", account: "transfer", status: "locked" },
    ]);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([...TRANSACTION_CSV_HEADER]);
    expect(rows[1]).toEqual([
      "2026-11-01",
      "支出",
      "supplies",
      "消耗品費",
      "〇〇商店",
      "備品,購入",
      "12000",
      "下書き",
    ]);
    expect(rows[2][1]).toBe("収入");
    expect(rows[2][7]).toBe("確定");
    expect(rows[3][1]).toBe("振替");
    expect(rows[3][7]).toBe("締め済み");
  });
});

const HEADER = TRANSACTION_CSV_HEADER.join(",");

describe("parseTransactionsCsv", () => {
  it("ヘッダー付きの正常行を登録入力へ変換する", () => {
    const { rows, fileError } = parseTransactionsCsv(
      `${HEADER}\n2026-11-01,支出,supplies,消耗品費,〇〇商店,備品購入,12000,下書き`,
    );
    expect(fileError).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].input).toEqual({
      type: "expense",
      date: "2026-11-01",
      amount: 12000,
      account: "supplies",
      counterparty: "〇〇商店",
      description: "備品購入",
    });
  });

  it("エクスポート形式をそのまま取り込める(ラウンドトリップ)", () => {
    const csv = buildTransactionsCsv([transactionFixture]);
    const { rows } = parseTransactionsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].input).toMatchObject({
      type: "expense",
      date: "2026-11-01",
      amount: 12000,
      account: "supplies",
    });
  });

  it("ヘッダーなしはエクスポート列順として解釈する", () => {
    const { rows } = parseTransactionsCsv(
      "2026-11-02,income,sales,売上高,△△商事,11月分,98000,確定",
    );
    expect(rows[0].rowNumber).toBe(1);
    expect(rows[0].input).toMatchObject({
      type: "income",
      account: "sales",
      amount: 98000,
    });
  });

  it("列順の入れ替えと余分な列をヘッダー名で吸収する", () => {
    const { rows } = parseTransactionsCsv(
      "番号,金額,科目コード,日付,種別\n9,5000,rent,2026-11-03,支出",
    );
    expect(rows[0].input).toMatchObject({
      date: "2026-11-03",
      type: "expense",
      account: "rent",
      amount: 5000,
    });
  });

  it("種別は英語コードも受理する", () => {
    const { rows } = parseTransactionsCsv(
      `${HEADER}\n2026-11-01,transfer,transfer,振替・口座間移動,,,3000,`,
    );
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].input?.type).toBe("transfer");
  });

  it("金額の桁区切り・全角数字・円記号を正規化する", () => {
    const { rows } = parseTransactionsCsv(
      `${HEADER}\n` +
        '2026-11-01,支出,supplies,消耗品費,,,"12,000",\n' +
        "2026-11-02,支出,supplies,消耗品費,,,￥１２３４,",
    );
    expect(rows[0].input?.amount).toBe(12000);
    expect(rows[1].input?.amount).toBe(1234);
  });

  it("各列のバリデーションエラーを行番号付きで返す", () => {
    const { rows } = parseTransactionsCsv(
      `${HEADER}\n` +
        "2026-13-01,支出,supplies,,,100,\n" +
        "2026-11-01,売上,supplies,,,100,\n" +
        "2026-11-01,支出,unknown_code,,,100,\n" +
        "2026-11-01,支出,supplies,,,-50,\n" +
        "2026-11-01,支出,supplies,,,12.5,\n" +
        ",,,,,,1",
    );
    expect(rows).toHaveLength(6);
    expect(rows[0].errors[0]).toContain("日付");
    expect(rows[1].errors[0]).toContain("種別");
    expect(rows[2].errors[0]).toContain("科目コード");
    expect(rows[3].errors[0]).toContain("金額");
    expect(rows[4].errors[0]).toContain("金額");
    expect(rows[5].errors.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.input === undefined)).toBe(true);
  });

  it("空行はデータ行として数えない", () => {
    const { rows } = parseTransactionsCsv(
      `${HEADER}\n2026-11-01,支出,supplies,,,100,\n,,\n\n`,
    );
    expect(rows).toHaveLength(1);
  });

  it("列数不足の行をエラーにする", () => {
    const { rows } = parseTransactionsCsv("2026-11-01,支出,supplies");
    expect(rows[0].errors[0]).toContain("列数");
  });

  it("必須列がないヘッダーはファイルエラーにする", () => {
    const { fileError, rows } = parseTransactionsCsv("日付,摘要\n2026-11-01,テスト");
    expect(fileError).toContain("必須列");
    expect(rows).toEqual([]);
  });

  it("データ行がない場合はファイルエラーにする", () => {
    expect(parseTransactionsCsv("").fileError).toBeDefined();
    expect(parseTransactionsCsv(HEADER).fileError).toBeDefined();
    expect(parseTransactionsCsv("\n\n").fileError).toBeDefined();
  });

  const customOptions = getAccountOptions({
    customAccounts: [
      { code: "software_fee", label: "ソフトウェア利用料", kind: "expense" },
      {
        code: "old_fee",
        label: "旧手数料",
        kind: "expense",
        disabled: true,
      },
    ],
  });

  it("カスタム科目コードをoptions経由で受理する", () => {
    const { rows } = parseTransactionsCsv(
      `${HEADER}\n2026-11-01,支出,software_fee,,,,9800,`,
      customOptions,
    );
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].input?.account).toBe("software_fee");
    // optionsを渡さない場合は未定義コードとしてエラー
    const { rows: defaultRows } = parseTransactionsCsv(
      `${HEADER}\n2026-11-01,支出,software_fee,,,,9800,`,
    );
    expect(defaultRows[0].errors[0]).toContain("定義されていません");
  });

  it("無効化された科目コードは取り込めない", () => {
    const { rows } = parseTransactionsCsv(
      `${HEADER}\n2026-11-01,支出,old_fee,,,,9800,`,
      customOptions,
    );
    expect(rows[0].errors[0]).toContain("無効化されています");
    expect(rows[0].input).toBeUndefined();
  });
});

describe("buildTransactionsCsv(カスタム科目)", () => {
  it("カスタム科目の科目名をoptions経由で解決する", () => {
    const options = getAccountOptions({
      customAccounts: [
        {
          code: "software_fee",
          label: "ソフトウェア利用料",
          kind: "expense",
        },
      ],
    });
    const csv = buildTransactionsCsv(
      [{ ...transactionFixture, account: "software_fee" }],
      options,
    );
    expect(parseCsv(csv)[1][3]).toBe("ソフトウェア利用料");
  });
});
