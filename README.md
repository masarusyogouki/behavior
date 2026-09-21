# behavior

MagicPod のように、ブラウザ上でテストを作成・実行できるサービスを目指すプロジェクトです。

## TypeScript を選んだ理由

- ブラウザ操作には、ロケータ、自動待機、トレースなどを利用できる Playwright を採用する。
- Playwright は JavaScript / TypeScript、Python、Java、.NET 向けの API を公式に提供しているが、現時点では Go を公式サポートしていない。
- Go から利用する場合はコミュニティ実装に依存するか、Playwright の内部プロトコルとの接続を自前で保守する必要がある。Playwright の更新に追従する負担をプロジェクト側で持たないため、公式 API を利用する。
- 現在の UI が React と TypeScript で実装されているため、バックエンドと Playwright Worker も TypeScript にすると、型や通信メッセージを共有しやすい。
- Playwright の中心実装と公式テストランナーは Node.js 上で動作するため、TypeScript から利用する構成が最も直接的で、公式ドキュメントや周辺機能も活用しやすい。

将来 Go が Playwright の公式対応言語になった場合の置き換えを妨げないように、テスト定義と通信 API は Playwright 固有の型から分離する。UI やデータベースには製品独自の操作形式を保存し、Playwright への変換は実行部分の内部に閉じ込める。

## ブラウザの方針

MVP では Chromium のみをコンテナに含める。Chrome、Microsoft Edge、Firefox などをすべて対象にするとイメージサイズと検証範囲が増えるため、必要になった段階で対応ブラウザを追加する。
まだ日本語未対応なので日本語対応させたい

## Worker 内の役割

`worker` は UI と WebSocket で通信し、接続ごとに Playwright のブラウザーセッションを作ります。現在の実装は次のファイルに分かれています。

| ファイル | 役割 |
| --- | --- |
| [`server.ts`](worker/server.ts) | WebSocket の接続元確認、ping/pong による接続監視、操作の受信順制御、切断時の終了処理。テキストの通知と JPEG 画像を UI に送る。 |
| [`protocol.ts`](worker/protocol.ts) | UI から受け取る操作と Worker から返す通知の型を定義し、受信した操作の形式と座標範囲を検証する。 |
| [`playwright/session.ts`](worker/playwright/session.ts) | 接続ごとに Chromium・コンテキスト・ページを作り、操作の実行、URL 変更の通知、スクリーンショットの撮影、終了処理を行う。 |
| [`config.ts`](worker/config.ts) | FPS、JPEG 品質、許可する Origin、初期 URL などの設定を読み取り、値を検証する。 |

受信した操作は `server.ts` → `protocol.ts` → `playwright/session.ts` の順に渡します。画面画像と通知はセッションから `server.ts` を通して UI に返します。Playwright に固有の操作は `playwright/session.ts` に置きます。
