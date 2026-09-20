FROM node:24-bookworm-slim

ENV PNPM_HOME=/opt/pnpm
ENV PATH="${PNPM_HOME}/bin:${PNPM_HOME}:${PATH}"

RUN corepack enable \
    && corepack prepare pnpm@11.8.0 --activate \
    && pnpm add -g playwright@1.63.0 \
    && playwright install --with-deps chromium

EXPOSE 3000
CMD ["playwright", "run-server", "--host", "0.0.0.0", "--port", "3000"]
