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
画面内をクリックしてフォーカスすると、Worker 側の Fcitx5/Anthy で日本語を変換できます。変換中の文字と候補は VNC 画面に表示されます。手元の IME はオフにし、遠隔画面では `Ctrl+Space` で日本語入力を切り替えてください。Worker イメージには日本語表示用フォントを含め、ブラウザーのロケールを `ja-JP` に設定します。

## ビルドと配置

設定ファイルは2つに分かれています。ルートの `.env.example` を `.env` にコピーすると、許可する Origin、CPU・メモリ上限などを Docker Compose と Worker に設定できます。`web/.env.example` を `web/.env.local` にコピーすると、フロントエンドの `NEXT_PUBLIC_WORKER_WS_URL` を設定できます。Next.js は `web` ディレクトリの環境変数を読み込むため、ルートの `.env` に書いても反映されません。

Worker は Xvfb 上の Chromium を使います。Docker ビルドでは Chromium 本体、Xvfb、x11vnc をインストールします。アプリのソースだけを変更したときは依存パッケージとブラウザーのレイヤーを再利用します。依存パッケージとブラウザーの取得内容も BuildKit のキャッシュに保持します。初回ビルドでは OS パッケージとブラウザーの取得が必要です。

フロントエンドは `web` を Vercel などに配置できます。公開環境では `NEXT_PUBLIC_WORKER_WS_URL` に Worker の公開 WebSocket URL（HTTPS の場合は `wss://`）をビルド時に設定し、Worker 側の `WORKER_ALLOWED_ORIGINS` にフロントエンドの Origin を追加してください。Worker は `PORT` 環境変数で待ち受けポートを変更でき、`/health` でヘルスチェックできます。

現在の Worker は接続ごとに Chromium を起動して WebSocket を維持します。Worker を Vercel に配置する場合は、コンテナ起動方式、実行時間、Chromium の実行可否を別途検証してください。公開 Worker の Origin チェックは認証ではないため、インターネットに公開する前に認証とアクセス制御も必要です。

## Worker 内の役割

`worker` は UI と WebSocket で通信し、接続ごとに Playwright のブラウザーセッションを作ります。現在の実装は次のファイルに分かれています。

| ファイル | 役割 |
| --- | --- |
| [`server.ts`](worker/server.ts) | WebSocket の接続元確認、ping/pong による接続監視、操作の受信順制御、VNC の WebSocket 中継、切断時の終了処理。 |
| [`protocol.ts`](worker/protocol.ts) | UI から受け取る操作と Worker から返す通知の型を定義し、受信した操作の形式と座標範囲を検証する。 |
| [`playwright/session.ts`](worker/playwright/session.ts) | 接続ごとに Chromium・コンテキスト・ページを作り、操作の実行、URL 変更の通知、終了処理を行う。 |
| [`vnc/display.ts`](worker/vnc/display.ts) | 接続ごとに Xvfb と x11vnc を起動・終了する。 |
| [`config.ts`](worker/config.ts) | 許可する Origin、初期 URL などの設定を読み取り、値を検証する。 |

画面は x11vnc → Worker の `/vnc/<一時トークン>` → noVNC の順で送ります。画面内の Chromium のタブやアドレスバー、Fcitx5/Anthy の変換候補は VNC 経由で操作・表示します。画面ごとに D-Bus と Fcitx5 を起動し、切断時に終了します。トークンは操作 WebSocket の接続ごとに発行し、切断時に破棄します。

以前の JPEG スクリーンショットを 60 FPS で撮影する方式では、接続するだけで CPU を約 1 コア使用していました。現在は変更領域を VNC で配信し、定期スクリーンショットは実行しません。

リポジトリのルートで、まず設定ファイルを作ります。

```powershell
Copy-Item .env.example .env
Copy-Item web/.env.example web/.env.local
```

次に、**ターミナルを2つ**使って起動します。

ターミナル1（worker）:

```powershell
docker compose up --build worker
```

ターミナル2（Next.js）:

```powershell
cd web
pnpm install --frozen-lockfile
pnpm dev
```

`http://localhost:3001` を開き、「接続」を押してください。
