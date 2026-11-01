import { Badge } from "./ui";

/**
 * ドメインの各ステータスを日本語ラベル+色で表示する。
 * 確定状態の区別(draft/confirmed/locked)をUIで明確にする。
 */

type Tone = "gray" | "green" | "amber" | "red" | "indigo" | "sky";

const TRANSACTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "下書き", tone: "amber" },
  confirmed: { label: "確定", tone: "green" },
  locked: { label: "締め済み", tone: "gray" },
};

const RECEIPT_STATUS: Record<string, { label: string; tone: Tone }> = {
  unprocessed: { label: "未処理", tone: "amber" },
  linked: { label: "紐付済み", tone: "green" },
  archived: { label: "アーカイブ", tone: "gray" },
};

const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "下書き", tone: "amber" },
  issued: { label: "発行済み", tone: "sky" },
  paid: { label: "入金済み", tone: "green" },
  overdue: { label: "期限超過", tone: "red" },
};

const PROJECT_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "進行中", tone: "green" },
  done: { label: "完了", tone: "sky" },
  archived: { label: "アーカイブ", tone: "gray" },
};

const PERIOD_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "未締め", tone: "green" },
  closed: { label: "締め済み", tone: "gray" },
};

const ROLE_LABEL: Record<string, { label: string; tone: Tone }> = {
  owner: { label: "オーナー", tone: "indigo" },
  editor: { label: "編集者", tone: "sky" },
  viewer: { label: "閲覧者", tone: "gray" },
};

const MAPS = {
  transaction: TRANSACTION_STATUS,
  receipt: RECEIPT_STATUS,
  invoice: INVOICE_STATUS,
  project: PROJECT_STATUS,
  period: PERIOD_STATUS,
  role: ROLE_LABEL,
} as const;

export function StatusBadge({
  kind,
  status,
}: {
  kind: keyof typeof MAPS;
  status: string;
}) {
  const entry = (MAPS[kind] as Record<string, { label: string; tone: Tone }>)[
    status
  ];
  return <Badge tone={entry?.tone ?? "gray"}>{entry?.label ?? status}</Badge>;
}
