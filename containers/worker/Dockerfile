FROM node:24-bookworm-slim

ENV PNPM_HOME=/opt/pnpm
ENV PATH="${PNPM_HOME}/bin:${PNPM_HOME}:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY worker/package.json ./

RUN corepack enable \
    && corepack prepare pnpm@11.8.0 --activate \
    && pnpm install --prod --no-frozen-lockfile

# Chromium's dependencies include a Japanese font; the headless shell avoids the full browser download.
RUN pnpm exec playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*

COPY worker/*.ts ./
COPY worker/playwright/ ./playwright/

EXPOSE 3000
CMD ["node", "server.ts"]
