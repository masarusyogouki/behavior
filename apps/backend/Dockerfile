FROM node:24.21.0-bookworm-slim

ARG PNPM_VERSION=12.5.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/pnpm \
    && curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linux-x64.tar.gz" \
      | tar -xz -C /opt/pnpm

ENV PATH="/opt/pnpm:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @behavior/backend exec playwright install --with-deps chromium \
    && useradd --create-home --shell /bin/bash pwuser \
    && chown -R pwuser:pwuser /workspace /ms-playwright

COPY --chown=pwuser:pwuser apps/backend apps/backend
COPY --chown=pwuser:pwuser packages/protocol packages/protocol

USER pwuser
EXPOSE 3001
CMD ["pnpm", "--filter", "@behavior/backend", "dev"]
