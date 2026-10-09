# syntax=docker/dockerfile:1
#
# rox-tg-linkd image. The service has no runtime dependencies (raw Bot API over
# `fetch`, `bun:sqlite` for storage), so the build only has to transpile.
#
#   docker build -f services/rox-tg-linkd/Dockerfile -t rox-tg-linkd:local .
#
# docker compose (services/rox-tg-linkd/docker-compose.yml) does this for you.
ARG BUN_IMAGE=oven/bun:1.4.2

FROM ${BUN_IMAGE} AS build
WORKDIR /repo
COPY services/rox-tg-linkd ./services/rox-tg-linkd
RUN bun build services/rox-tg-linkd/src/index.ts --target=bun --outfile=services/rox-tg-linkd/dist/rox-tg-linkd.js

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
COPY --from=build /repo/services/rox-tg-linkd/dist/rox-tg-linkd.js /app/rox-tg-linkd.js
ENV PORT=8095
ENV LINK_DB_PATH=/data/rox-tg-linkd.sqlite
# Named volumes inherit the image path's ownership on first use, so /data must
# be writable by the non-root `bun` user before it is declared.
RUN mkdir -p /data && chown bun:bun /data
VOLUME ["/data"]
EXPOSE 8095
USER bun
CMD ["bun", "run", "/app/rox-tg-linkd.js"]