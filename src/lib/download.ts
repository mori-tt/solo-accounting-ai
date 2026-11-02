import { CSV_UTF8_BOM } from "./csv";

/**
 * CSVテキストをBOM付きUTF-8の .csv ファイルとしてダウンロードする
 * (クライアントコンポーネント専用。BOMはExcelでの文字化け対策)。
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([CSV_UTF8_BOM + csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
