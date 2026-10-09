# syntax=docker/dockerfile:1
#
# rox-tg-bot image. The service has no runtime dependencies (raw Bot API over
# `fetch`, `bun:sqlite` for storage), so the build only has to transpile.
#
#   docker build -f services/rox-tg-bot/Dockerfile -t rox-tg-bot:local .
#
# docker compose (services/rox-tg-bot/docker-compose.yml) does this for you.
ARG BUN_IMAGE=oven/bun:1.4.2

FROM ${BUN_IMAGE} AS build
WORKDIR /repo
COPY services/rox-tg-bot ./services/rox-tg-bot
RUN bun build services/rox-tg-bot/src/index.ts --target=bun --outfile=services/rox-tg-bot/dist/rox-tg-bot.js

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
COPY --from=build /repo/services/rox-tg-bot/dist/rox-tg-bot.js /app/rox-tg-bot.js
ENV PORT=8789
ENV TG_LINK_DB=/data/state.sqlite
VOLUME ["/data"]
EXPOSE 8789
USER bun
CMD ["bun", "run", "/app/rox-tg-bot.js"]