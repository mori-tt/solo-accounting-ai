# AGENTS.md

## Product

個人事業主・小規模事業者向けの
経理・決算準備・確定申告準備アプリ。

## Stack

- Next.js App Router
- TypeScript
- Firebase Authentication
- Cloud Firestore
- Cloud Storage
- Cloud Functions
- Firebase Emulator Suite
- Vitest
- Playwright

## Rules

- mainへ直接変更を加えない
- 1タスク1Worktree
- 金額は円単位の整数で保存する
- AI提案と確定データを分離する
- AIだけで仕訳を確定しない
- businessIdをまたいだアクセスを禁止する
- 締め済み期間のデータを直接変更しない
- 個人情報や証憑内容をログ出力しない
- Security Rulesをテストする
- 作業内容をREVIEW.mdへ記録する

## Required Checks

- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm build
- Firebase Emulator tests

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
