# The image one hosted workspace runs in (docs/hosted.md, "Running the hub"). Build it from the repository root:
#
#   docker build -f deploy/workspace.Dockerfile --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:... -t copperflow-workspace .
#
# The base image. Pin it by digest on the server, the tag kept in this comment:
#   node:22-bookworm-slim
# To refresh: `docker pull node:22-bookworm-slim`, then `docker image inspect --format '{{index .RepoDigests 0}}'
# node:22-bookworm-slim` prints `node@sha256:...`; build with `--build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:...`.
# The default below is the bare tag only because the digest must be read on a machine with network access; the hub
# warns at start when the image it runs was built without a digest (the label below).
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE}
ARG NODE_IMAGE
LABEL org.copperflow.base="${NODE_IMAGE}"
# The image's own user, uid 10001. The runner starts containers as 10001:<workspace group> (or, with
# --workspace-user-same-as-hub, as the hub's own uid:gid), so the image works for any gid: the app is root-owned and
# world-readable, and HOME and caches are under /tmp.
RUN groupadd --gid 10001 workspace && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin workspace
WORKDIR /app
COPY --from=build --chown=root:root /src/package.json ./package.json
COPY --from=build --chown=root:root /src/node_modules ./node_modules
COPY --from=build --chown=root:root /src/dist ./dist
COPY --from=build --chown=root:root /src/skills ./skills
ENV NODE_ENV=production HOME=/tmp NPM_CONFIG_CACHE=/tmp/.npm
USER 10001:10001
WORKDIR /work
# The main thread's heap stays well under the container's 512 MB (the workers get 256 MB each in hosted mode), so
# unbounded allocation ends as a build error before the container is killed.
ENTRYPOINT ["node", "--max-old-space-size=160", "/app/dist/cli.js", "workspace"]
