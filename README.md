# behavior

MagicPod のように、ブラウザ上でテストを作成・実行できるサービスを目指すプロジェクトです。

## ビルドと配置

設定ファイルは2つに分かれています。ルートの `.env` は Docker Compose と Worker 用、`web/.env.local` は Next.js 用です。`npm run setup:local` で両方の設定と開発用RSA鍵・セッションIDを準備できます。既存ファイルの接続・認証設定はローカル用に更新し、それ以外の設定は保持します。鍵とセッションIDを毎回更新するため、実行後はwebとWorkerを再起動してください。生成した設定はGitの追跡対象外です。

Worker は Xvfb 上の Chromium を使います。Docker ビルドでは Chromium 本体、Xvfb、x11vnc をインストールします。アプリのソースだけを変更したときは依存パッケージとブラウザーのレイヤーを再利用します。依存パッケージとブラウザーの取得内容も BuildKit のキャッシュに保持します。初回ビルドでは OS パッケージとブラウザーの取得が必要です。

フロントエンドは vinext を使って Cloudflare Workers に配置できます。公開環境ではWeb APIがGitHub Appを介してWorker workflowを起動し、Quick Tunnelの一時URLへ接続します。ローカルでは `WORKER_CONNECTION_MODE=local` によってWeb APIがDockerのWorkerの稼働を確認し、同じ形式のJWTを発行します。`WORKER_LOCAL_WS_URL` はサーバー側の設定で、loopback宛ての `ws://` のみ指定できます。localモードは `pnpm dev` 専用です。本番では `WORKER_CONNECTION_MODE` を設定せず、Cloudflare Secretsに本番用の署名鍵とGitHub App設定を登録してください。Worker 側の `WORKER_ALLOWED_ORIGINS` にはフロントエンドのOriginを指定します。Worker は `PORT` 環境変数で待ち受けポートを変更でき、`/health` でヘルスチェックできます。

制御WebSocketはRS256の短期セッションJWTを必須とし、`behavior.v1` と `behavior.jwt.<JWT>` の2つのWebSocketサブプロトコルで渡します。Workerには `WORKER_SESSION_PUBLIC_KEY`、`WORKER_SESSION_ID`、`WORKER_SESSION_AUDIENCE` だけを設定し、署名用秘密鍵は渡しません。JWTは `sessionId`、`audience`、`exp`、`jti` を検証し、一度使用した `jti` を拒否します。GitHub App秘密鍵とセッションJWT署名鍵はCloudflare Workers Secretsだけに保存し、ブラウザーやWorkerコンテナへ渡しません。

Cloudflare Workers 向けのローカル確認は `web` ディレクトリで行います。`build:vinext` が Workers 用成果物を生成し、`start:vinext` が Wrangler のローカル runtime で配信します。`dev` は従来どおり `http://localhost:3001` の Next.js 開発サーバーを起動します。

```powershell
cd web
pnpm install --frozen-lockfile
pnpm build:vinext
pnpm start:vinext
```

Cloudflare へログインした環境では次のコマンドで `*.workers.dev` へ配置します。初回実行時は Cloudflare の認証と Workers サブドメインの設定が必要です。

```powershell
cd web
pnpm deploy:vinext
```

現在の Worker は認証済み接続ごとに Chromium を起動して WebSocket を維持します。制御接続は同時に1本だけ許可し、通常切断後は既定で10分間だけ再接続を待ち、明示切断ではWorkerを終了します。Worker をVercelへ配置する場合は、コンテナ起動方式、実行時間、Chromiumの実行可否を別途検証してください。

## Worker 内の役割

`worker` は UI と WebSocket で通信し、接続ごとに Playwright のブラウザーセッションを作ります。現在の実装は次のファイルに分かれています。

| ファイル | 役割 |
| --- | --- |
| [`adapters/websocket-server.ts`](worker/adapters/websocket-server.ts) | WebSocket の接続元確認、ping/pong による接続監視、操作の受信順制御、VNC の WebSocket 中継、切断時の終了処理。 |
| [`shared/contracts/browser.ts`](shared/contracts/browser.ts) | UI から受け取る操作と Worker から返す通知の型を定義し、受信した操作の形式と座標範囲を検証する。 |
| [`adapters/playwright/session.ts`](worker/adapters/playwright/session.ts) | 接続ごとに Chromium・コンテキスト・ページを作り、操作の実行、URL 変更の通知、終了処理を行う。 |
| [`adapters/security/session-auth.ts`](worker/adapters/security/session-auth.ts) | セッションJWTの署名・claim・有効期限・再利用を検証する。 |
| [`adapters/security/network-policy.ts`](worker/adapters/security/network-policy.ts) | localhost、プライベートIP、リンクローカル、メタデータ宛てなどのブラウザー通信を遮断する。 |
| [`adapters/vnc/display.ts`](worker/adapters/vnc/display.ts) | 接続ごとに Xvfb と x11vnc を起動・終了する。 |
| [`config.ts`](worker/config.ts) | 許可する Origin、初期 URL などの設定を読み取り、値を検証する。 |

画面は x11vnc → Worker の `/vnc/<一時トークン>` → noVNC の順で送ります。画面内の Chromium のタブやアドレスバー、Fcitx5/Anthy の変換候補は VNC 経由で操作・表示します。画面ごとに D-Bus と Fcitx5 を起動し、切断時に終了します。トークンは操作 WebSocket の接続ごとに発行し、切断時に破棄します。

以前の JPEG スクリーンショットを 60 FPS で撮影する方式では、接続するだけで CPU を約 1 コア使用していました。現在は変更領域を VNC で配信し、定期スクリーンショットは実行しません。

リポジトリのルートで、まず設定ファイルを作ります。

```powershell
npm run setup:local
```

次に、**ターミナルを2つ**使って起動します。

ターミナル1（worker）:

```powershell
docker compose up --build --force-recreate worker
```

ターミナル2（Next.js）:

```powershell
cd web
pnpm install --frozen-lockfile
pnpm dev
```

`http://localhost:3001` を開き、画面の接続操作でWorkerのブラウザー画面を確認します。ローカルではGitHub AppやCloudflareへのpushは不要で、現在の作業ツリーのコードを使用します。制御WebSocketのJWT認証とVNC画面の経路は本番と共通です。1つのWorkerへ接続できる画面は同時に1つです。明示切断するとWorkerも終了するため、再度試すときはターミナル1で `docker compose up worker` を実行してください。Workerのコードを変更した場合は `docker compose up --build worker` で再ビルドします。

この手順ではCloudflare runtimeやGitHub Actions・Quick Tunnelの起動処理は検証しません。それらはWorkers用のローカルruntime、またはブランチのPreviewで別途確認します。

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir worker install --frozen-lockfile
npm test
pnpm --dir web typecheck
pnpm --dir worker typecheck
pnpm --dir web lint
pnpm --dir web build
pnpm --dir web build:vinext
```

WebのDockerビルドも共有契約を含めるため、リポジトリルートをcontextにします。

```sh
docker build -f web/Dockerfile -t behavior-web .
```
