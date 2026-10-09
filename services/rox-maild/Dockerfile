# syntax=docker/dockerfile:1
#
# rox-maild image. Built from the repository root so the workspace dependency
# `@rox/shared/mail` resolves with the repo's lockfile:
#
#   docker build -f services/rox-maild/Dockerfile -t rox-maild:local .
#
# docker compose (services/rox-maild/docker-compose.yml) does this for you.
ARG BUN_IMAGE=oven/bun:1.4.2

FROM ${BUN_IMAGE} AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bun build services/rox-maild/src/index.ts --target=bun --outfile=services/rox-maild/dist/rox-maild.js

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
COPY --from=build /repo/services/rox-maild/dist/rox-maild.js /app/rox-maild.js
ENV PORT=8080
EXPOSE 8080
USER bun
CMD ["bun", "run", "/app/rox-maild.js"]