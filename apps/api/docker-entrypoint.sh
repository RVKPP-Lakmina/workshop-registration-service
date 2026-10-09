#!/bin/sh
set -e
# Apply pending migrations (idempotent), optionally seed demo data, then start the app.
if [ -d prisma ] || [ -f prisma.config.ts ]; then
  echo "[entrypoint] prisma migrate deploy"
  pnpm exec prisma migrate deploy
  if [ "$SEED_ON_START" = "true" ]; then
    echo "[entrypoint] seeding demo data"
    pnpm exec prisma db seed
  fi
fi
exec "$@"
