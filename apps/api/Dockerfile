# Multi-stage production build for the FieldMaster API.
# Build from the monorepo root: docker build -f apps/api/Dockerfile .
#
# The runtime image copies node_modules wholesale from the build stage
# rather than doing a separate `--prod` install: this is a pnpm workspace,
# so the generated Prisma client lives inside the pnpm content-addressable
# store (node_modules/.pnpm/...), not in a location a fresh `--prod`
# install can easily reproduce without re-running `prisma generate` after
# the schema is already copied in. Copying the whole tree is simpler and
# more reliable for a workspace this size; image size was not optimized.

FROM node:22-slim AS base
RUN corepack enable
# Installed here (not just in the runtime stage) so `prisma generate` in the
# build stage detects the same OpenSSL version the runtime image will have
# -- otherwise Prisma bakes in the wrong query-engine binary target.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-validation/package.json packages/shared-validation/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @fieldmaster/shared-types build \
 && pnpm --filter @fieldmaster/shared-validation build \
 && pnpm --filter @fieldmaster/api exec prisma generate \
 && pnpm --filter @fieldmaster/api build

FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/packages ./packages

# Playwright's Chromium is needed for PDF report generation; installed at
# runtime-image build time so it matches this image's OS libraries. Calls
# the vendored binary directly rather than `npx`/`pnpm exec` (which need
# workspace root files this stage doesn't copy in).
RUN ./apps/api/node_modules/.bin/playwright install --with-deps chromium

EXPOSE 3000
WORKDIR /repo/apps/api
CMD ["node", "dist/src/main.js"]
