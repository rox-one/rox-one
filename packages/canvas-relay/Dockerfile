# Build: docker build -t rox-canvas-relay -f packages/canvas-relay/Dockerfile packages/canvas-relay
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY src ./src
RUN bun build src/main.ts --compile --minify --outfile /out/rox-canvas-relay

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /out/rox-canvas-relay /usr/local/bin/rox-canvas-relay
ENV DATA_DIR=/data PORT=8787
VOLUME ["/data"]
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/rox-canvas-relay"]
