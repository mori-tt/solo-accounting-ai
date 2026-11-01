"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { updateBusinessSettings } from "@/lib/actions/businesses";
import type { MyBusiness } from "@/lib/actions/businesses";
import { callApi } from "@/lib/api-client";
import { ACCOUNT_OPTIONS } from "@/lib/accounts";
import { isAllocationRatio } from "@/lib/accounting/domain/allocation";
import { businessSchema, parseForm } from "@/lib/validation/schemas";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  NumberInput,
  PageHeader,
  tableClass,
} from "@/components/ui";

const EXPENSE_ACCOUNTS = ACCOUNT_OPTIONS.filter((a) => a.kind === "expense");

function savedRatios(business: MyBusiness): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [code, ratio] of Object.entries(business.allocationRatios ?? {})) {
    out[code] = String(ratio);
  }
  return out;
}

function AllocationForm({ business }: { business: MyBusiness }) {
  const { businessId, reloadBusinesses } = useApp();
  const [ratios, setRatios] = useState<Record<string, string>>(() =>
    savedRatios(business),
  );
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const setRatio = (code: string, value: string) => {
    setRatios((prev) => ({ ...prev, [code]: value }));
    setSaved(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const allocationRatios: Record<string, number> = {
      ...(business.allocationRatios ?? {}),
    };
    for (const account of EXPENSE_ACCOUNTS) {
      const raw = (ratios[account.code] ?? "").trim();
      if (raw === "") {
        delete allocationRatios[account.code];
        continue;
      }
      const value = Number(raw);
      if (!isAllocationRatio(value)) {
        setError(`${account.label}の事業割合は0〜100の整数で入力してください`);
        return;
      }
      allocationRatios[account.code] = value;
    }
    const parsed = parseForm(businessSchema, {
      name: business.name,
      fiscalYearStartMonth: business.fiscalYearStartMonth,
      taxMode: business.taxMode,
      allocationRatios,
    });
    if (!parsed.success) {
      setError(parsed.issues.join(" / "));
      return;
    }
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await callApi(() =>
        updateBusinessSettings(businessId ?? "", parsed.data),
      );
      setSaved(true);
      reloadBusinesses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="overflow-x-auto">
        <table className={tableClass}>
          <thead>
            <tr>
              <th>勘定科目</th>
              <th className="w-40">事業割合(%)</th>
            </tr>
          </thead>
          <tbody>
            {EXPENSE_ACCOUNTS.map((account) => (
              <tr key={account.code}>
                <td>{account.label}</td>
                <td>
                  <NumberInput
                    value={ratios[account.code] ?? ""}
                    min={0}
                    max={100}
                    step={1}
                    placeholder="100"
                    aria-label={`${account.label}の事業割合`}
                    onChange={(e) => setRatio(account.code, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}
      {saved && <Alert tone="info" className="mt-3">保存しました</Alert>}
      <div className="mt-4">
        <Button type="submit" loading={busy}>
          保存する
        </Button>
      </div>
    </form>
  );
}

export function AllocationsScreen() {
  useBrowserOnly();
  const { business } = useApp();
  const isOwner = business?.role === "owner";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="家事按分"
        description="経費科目ごとに事業で使う割合(%)を設定します。未入力の科目は100%(全額事業分)として扱い、按分後の金額は月次レポートで確認できます。按分額は円未満切り捨てです。"
      />
      <Card>
        <h2 className="mb-3 text-sm font-semibold">科目別の事業割合</h2>
        {!business ? (
          <EmptyState title="事業を読み込めませんでした" />
        ) : isOwner ? (
          <AllocationForm key={business.id} business={business} />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>勘定科目</th>
                  <th className="w-40">事業割合(%)</th>
                </tr>
              </thead>
              <tbody>
                {EXPENSE_ACCOUNTS.map((account) => {
                  const ratio = business.allocationRatios?.[account.code];
                  return (
                    <tr key={account.code}>
                      <td>{account.label}</td>
                      <td>{ratio === undefined ? "100(未設定)" : ratio}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
