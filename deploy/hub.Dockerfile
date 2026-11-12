# The hub's own image, for arrangement A (deploy/compose.yaml: the hub in a container, --workspace-reach network).
# Built from the repository root like the workspace image, the bases pinned by digest (deploy/README.md, step 4):
#
#   docker build -f deploy/hub.Dockerfile \
#     --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:... \
#     --build-arg DOCKER_CLI_IMAGE=docker:27-cli@sha256:... \
#     -t copperflow-hub:1 .
#
# Inside: the same build as deploy/workspace.Dockerfile and the docker command-line client (one static binary copied
# from the official CLI image), to drive the HOST's engine through the socket Compose mounts. That socket is
# root-equivalent on the host (README, "What the Docker socket means"). No engine runs in this image.
ARG NODE_IMAGE=node:22-bookworm-slim
ARG DOCKER_CLI_IMAGE=docker:27-cli

FROM ${DOCKER_CLI_IMAGE} AS dockercli

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE}
ARG NODE_IMAGE
ARG DOCKER_CLI_IMAGE
LABEL org.copperflow.base="${NODE_IMAGE}" org.copperflow.docker-cli="${DOCKER_CLI_IMAGE}"
COPY --from=dockercli --chown=root:root /usr/local/bin/docker /usr/local/bin/docker
# A default user that is neither root nor the workspaces' uid 10001. Compose runs the container as the host's
# copperflow-hub uid:gid instead (user:), with the workspace group and the socket's group added (group_add:).
RUN groupadd --gid 10002 copperflow-hub && useradd --uid 10002 --gid 10002 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin copperflow-hub
WORKDIR /app
COPY --from=build --chown=root:root /src/package.json ./package.json
COPY --from=build --chown=root:root /src/node_modules ./node_modules
COPY --from=build --chown=root:root /src/dist ./dist
COPY --from=build --chown=root:root /src/skills ./skills
# The root filesystem is read-only in Compose: the docker client keeps its config in /tmp (a tmpfs).
ENV NODE_ENV=production HOME=/tmp DOCKER_CONFIG=/tmp/.docker
USER 10002:10002
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["hub"]
