# ACCOUNTING_RULES.md

会計・仕訳に関するアプリ内ルール。

## 基本原則

- 金額はすべて円単位の整数で保存する(小数・浮動小数点を使わない)
- 計算途中で端数が出る場合は、税計算ルールに従い丸める
- 税込経理か税抜経理かはBusiness設定で管理する(初期版は税込表示を基準にする)

## 会計期間

- Businessごとに `fiscalYearStartMonth` を持つ
- 個人事業主のデフォルトは1月(暦年課税)
- 期間は `fiscalPeriods` で管理し、`open` / `closed` の状態を持つ

## 締め済みデータの扱い

- `fiscalPeriods.status = closed` の期間に属するデータは直接変更しない
- Transactionの `status = locked` は締め済みを示す
- 修正が必要な場合は、取消し仕訳または補正仕訳を次のオープン期間に記録する

## 取引ステータス

- `draft`: 入力途中・未確認
- `confirmed`: ユーザーが内容を確認し確定した
- `locked`: 締め済み期間に属し変更不可

AI提案を適用しただけでは `confirmed` にしない。
必ずユーザーの承認操作を経る。

## 消費税

- `taxMode`: `exempt`(免税事業者)/ `simple`(簡易課税)/ `standard`(本則課税)
- 経費には `taxCategory` を持たせる(課税仕入 / 非課税 / 不課税 / 免税)
- 端数処理はBusiness単位で統一する(初期版: 切り捨て)

## 未払・未収の管理

- Expense: `paymentDueDate` + `paidAt` で未払経費を検出する
- Invoice: `dueDate` + `status` で未入金を検出する
- 締め処理時に未払・未収の存在をチェックリストで可視化する

## 月次集計

- `monthlySummaries/{yyyyMM}` に科目別・収支の集計を保持する
- 集計はCloud Functions等で再計算可能にする(手計算値の保存禁止)

## 仕訳確定の責任

- AIは科目・金額の提案のみ行う
- 仕訳の確定責任はユーザーにある。AIのみで確定しない
