FROM node:24-bookworm-slim

ENV PNPM_HOME=/opt/pnpm
ENV PATH="${PNPM_HOME}/bin:${PNPM_HOME}:${PATH}"

WORKDIR /app
COPY worker/package.json ./

RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.8.0 --activate \
    && pnpm install --prod --no-frozen-lockfile \
    && pnpm exec playwright install --with-deps chromium

COPY worker/*.ts ./
COPY worker/playwright/ ./playwright/

EXPOSE 3000
CMD ["node", "server.ts"]
