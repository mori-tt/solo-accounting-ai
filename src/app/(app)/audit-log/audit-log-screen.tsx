"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { listAuditLogs } from "@/lib/actions/audit-logs";
import { callApi } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  auditActionLabel,
  auditTargetTypeLabel,
  describeAuditEntry,
  filterAuditLogs,
  parseAuditTargetPath,
} from "@/lib/audit-log-view";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Select,
  TextInput,
  tableClass,
} from "@/components/ui";

/** 1回の「さらに読み込み」で追加表示する件数 */
const PAGE_SIZE = 50;

type BadgeTone = "gray" | "green" | "amber" | "red" | "indigo" | "sky";

const ACTION_BADGE_TONE: Record<string, BadgeTone> = {
  create: "green",
  update: "indigo",
  delete: "red",
  close: "amber",
  run_ai: "sky",
  approve_ai: "sky",
  reject_ai: "gray",
};

/** 日付入力(YYYY-MM-DD)をその日のローカル開始・終了時刻のISOへ変換する */
function dayStartIso(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}
function dayEndIso(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

/** メンバー名が解決できない場合の表示(uidの先頭部分) */
function actorLabel(actorUid: string): string {
  return actorUid.length > 8 ? `${actorUid.slice(0, 8)}…` : actorUid;
}

export function AuditLogScreen() {
  useBrowserOnly();
  const { businessId } = useApp();

  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => listAuditLogs(businessId ?? "")),
    [businessId],
  );

  // フィルタ変更時は表示件数を先頭に戻す
  const onFilterChange = (apply: (value: string) => void) =>
    (e: { target: { value: string } }) => {
      apply(e.target.value);
      setVisibleCount(PAGE_SIZE);
    };

  const filtered = useMemo(
    () =>
      filterAuditLogs(data ?? [], {
        action: action || undefined,
        targetType: targetType || undefined,
        startAt: startDate ? dayStartIso(startDate) : undefined,
        endAt: endDate ? dayEndIso(endDate) : undefined,
      }),
    [data, action, targetType, startDate, endDate],
  );
  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="監査ログ"
        description="データの作成・更新・削除・締め操作の履歴です(閲覧専用)"
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TextInput
          type="date"
          className="w-40"
          value={startDate}
          onChange={onFilterChange(setStartDate)}
          aria-label="開始日"
        />
        <span className="text-sm text-zinc-400">〜</span>
        <TextInput
          type="date"
          className="w-40"
          value={endDate}
          onChange={onFilterChange(setEndDate)}
          aria-label="終了日"
        />
        <Select
          className="w-36"
          value={action}
          onChange={onFilterChange(setAction)}
          aria-label="操作で絞り込み"
        >
          <option value="">すべての操作</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
        <Select
          className="w-44"
          value={targetType}
          onChange={onFilterChange(setTargetType)}
          aria-label="対象種別で絞り込み"
        >
          <option value="">すべての対象</option>
          {AUDIT_TARGET_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        {data !== undefined && (
          <span className="text-xs text-zinc-400">
            {filtered.length}件 / 全{data.length}件
          </span>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <ErrorState onRetry={reload} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={
            data.length > 0
              ? "条件に一致するログがありません"
              : "監査ログはまだありません"
          }
          description="データの作成・更新・削除・締め操作が記録されます"
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>ユーザー</th>
                  <th>操作</th>
                  <th>対象種別</th>
                  <th>対象ID</th>
                  <th>概要</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((log) => {
                  const target = parseAuditTargetPath(log.targetPath);
                  return (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td>
                        <span title={log.actorUid}>
                          {log.actorName ?? actorLabel(log.actorUid)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        <Badge
                          tone={ACTION_BADGE_TONE[log.action] ?? "gray"}
                        >
                          {auditActionLabel(log.action)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap">
                        {target ? auditTargetTypeLabel(target.collection) : "-"}
                      </td>
                      <td
                        className="max-w-40 truncate font-mono text-xs"
                        title={log.targetPath}
                      >
                        {target?.docId ?? log.targetPath}
                      </td>
                      <td>{describeAuditEntry(log)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {visibleCount < filtered.length && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                さらに読み込む(残り{filtered.length - visibleCount}件)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
