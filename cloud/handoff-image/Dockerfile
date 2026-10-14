# Daytona snapshot for «В облако» cloud sessions: rox-session-server-v1.
# Build on top of the headless server image (Dockerfile.server at repo root):
#   docker build -f Dockerfile.server -t rox-server:local .
#   docker build -f cloud/handoff-image/Dockerfile --build-arg ROX_SERVER_IMAGE=rox-server:local -t rox-session-server-v1 .
#   daytona snapshot push rox-session-server-v1   (or create the snapshot from this image in the Daytona dashboard)
ARG ROX_SERVER_IMAGE=rox-server:local
FROM ${ROX_SERVER_IMAGE}

USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && (id -u daytona >/dev/null 2>&1 || useradd -m -d /home/daytona -s /bin/bash daytona) \
 && mkdir -p /home/daytona/rox-handoff /home/daytona/.rox && chown -R daytona:daytona /home/daytona
COPY cloud/handoff-image/rox-handoff-start cloud/handoff-image/rox-handoff-health /usr/local/bin/
RUN chmod 0755 /usr/local/bin/rox-handoff-start /usr/local/bin/rox-handoff-health

USER daytona
WORKDIR /home/daytona
# Daytona keeps the sandbox alive; the session server is started by rox-handoff-start.
ENTRYPOINT ["sleep", "infinity"]
