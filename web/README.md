# Web

Next.js のフロントエンドです。ブラウザーから Worker の操作 WebSocket と VNC WebSocket に直接接続し、noVNC で画面を表示します。

## ローカル開発

ルートの `.env.example` を `.env` にコピーし、`docker compose up --build worker` で Worker を起動します。`web/.env.example` を `web/.env.local` にコピーしてから、`web` で以下を実行します。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

画面は `http://localhost:3001` で開きます。Worker は `localhost:3000` です。`pnpm lint` と `pnpm build` で確認できます。

## Docker

リポジトリの `web` ディレクトリでビルドします。ブラウザーで使う `NEXT_PUBLIC_WORKER_WS_URL` はビルド時に指定してください。HTTPS の画面には `wss://` の接続先が必要です。

```sh
docker build --build-arg NEXT_PUBLIC_WORKER_WS_URL=ws://127.0.0.1:3000 -t behavior-web .
docker run --rm -p 3001:3001 behavior-web
```

Worker の `WORKER_ALLOWED_ORIGINS` に画面の Origin を指定してください。Dockerfile は独立した環境での実行用です。Vercel への通常の Next.js 配置には使用しません。
