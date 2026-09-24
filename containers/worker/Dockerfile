# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim

ENV PNPM_HOME=/opt/pnpm
ENV PATH="${PNPM_HOME}/bin:${PNPM_HOME}:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV LANG=C.UTF-8

WORKDIR /app

COPY worker/package.json ./

# 依存の取得結果をビルド間で再利用する。
RUN --mount=type=cache,target=/opt/pnpm/store \
    corepack enable \
    && corepack prepare pnpm@11.8.0 --activate \
    && pnpm install --prod --no-frozen-lockfile --prefer-offline --store-dir /opt/pnpm/store

# 画面付き Chromium と VNC・日本語入力を用意する。headless shell は使わない。
RUN --mount=type=cache,target=/opt/playwright-cache \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-cache pnpm exec playwright install --with-deps --no-shell chromium \
    && apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc dbus-x11 fcitx5 fcitx5-anthy fcitx5-frontend-gtk3 \
    && mkdir -p /ms-playwright && cp -a /opt/playwright-cache/. /ms-playwright/ \
    && rm -rf /var/lib/apt/lists/*

COPY worker/*.ts ./
COPY worker/playwright/ ./playwright/
COPY worker/vnc/ ./vnc/
COPY containers/worker/fcitx5/profile /root/.config/fcitx5/profile

EXPOSE 3000
CMD ["node", "server.ts"]
