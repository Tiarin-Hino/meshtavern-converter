# The image `npm run docker:check` and `npm run docker:e2e` run in (scripts/docker-test.mjs).
# Playwright's own image carries Chromium and the libraries it needs; the tag must match the
# @playwright/test version in package-lock.json, or the browser it expects is missing.
# Only the dependencies are baked in: the image is rebuilt when the lockfile changes, and each run
# copies the working tree into a fresh container that is removed afterwards.
FROM mcr.microsoft.com/playwright:v1.64.0-noble
LABEL meshtavern-test=1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY docker/test-entrypoint.sh /usr/local/bin/test-entrypoint
RUN chmod +x /usr/local/bin/test-entrypoint
ENTRYPOINT ["test-entrypoint"]
