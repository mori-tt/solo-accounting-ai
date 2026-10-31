# DECISIONS.md

アーキテクチャ上の重要な意思決定の記録(ADR)。

## フォーマット

```
## ADR-NNNN: タイトル

- 日付: YYYY-MM-DD
- ステータス: proposed / accepted / superseded
- コンテキスト: <背景・課題>
- 決定: <採用した方針>
- 理由: <なぜそうしたか>
- 影響: <この決定がもたらす制約・トレードオフ>
```

## ADR一覧

| ID | タイトル | ステータス | 日付 |
|---|---|---|---|
| ADR-0001 | Next.js App Router + Firebase | accepted | 2026-10-31 |
| ADR-0002 | 金額は円単位の整数で保存 | accepted | 2026-10-31 |
| ADR-0003 | AI提案と確定データの分離 | accepted | 2026-10-31 |
| ADR-0004 | 1タスク1Worktree | accepted | 2026-10-31 |

---

## ADR-0001: Next.js App Router + Firebase

- 日付: 2026-10-31
- ステータス: accepted
- コンテキスト: 経理アプリの土台となるフレームワーク・BaaSの選定
- 決定: Next.js App Router(TypeScript)+ Firebase(Authentication / Firestore / Storage / Functions / Emulator Suite)
- 理由: 認証・DB・ストレージ・サーバーレス実行を一元化でき、個人〜小規模開発に適する。Emulatorでローカル検証可能
- 影響: Firestoreのクエリ制約・Security Rulesの複雑さを設計に織り込む必要がある

## ADR-0002: 金額は円単位の整数で保存

- 日付: 2026-10-31
- ステータス: accepted
- コンテキスト: 金額のデータ表現
- 決定: すべての金額は円単位の整数(number)で保存する
- 理由: 浮動小数点による誤差を構造的に排除できる。日本円は小数点以下を持たない
- 影響: 税計算などで端数が出る場合の丸めルールが必要(ACCOUNTING_RULES.md参照)

## ADR-0003: AI提案と確定データの分離

- 日付: 2026-10-31
- ステータス: accepted
- コンテキスト: AIによる仕訳支援の扱い
- 決定: AI出力は `aiSuggestion` フィールドに隔離し、確定値への反映はユーザー承認制とする
- 理由: 会計データの確定責任を人間に残すため。誤提案の自動反映を防ぐ
- 影響: データモデルとUIで提案/確定を常に区別する必要がある

## ADR-0004: 1タスク1Worktree

- 日付: 2026-10-31
- ステータス: accepted
- コンテキスト: 複数タスクの並行開発フロー
- 決定: タスクごとにgit worktreeを分けて作業し、mainへ直接変更しない
- 理由: 変更の分離・レビューしやすさ・壊れた作業の切り捨てやすさのため
- 影響: 管理ファイル(本ドキュメント群)で状態を共有する必要がある
