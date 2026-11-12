# The image one hosted workspace runs in (docs/hosted.md, "Running the hub"). Build it from the repository root:
#
#   docker build -f deploy/workspace.Dockerfile -t copperflow-workspace .
#
# The base image. Pin it by digest on the server, the tag kept in this comment:
#   node:22-bookworm-slim
# To refresh: `docker pull node:22-bookworm-slim`, then `docker image inspect --format '{{index .RepoDigests 0}}'
# node:22-bookworm-slim` prints `node@sha256:...`; build with `--build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:...`
# and write that digest here. The default below is the bare tag only because the digest must be read on a machine
# with network access; a production build always passes the digest.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE}
# A fixed user and group that own nothing on the host; the runner starts the container as 10001:10001.
RUN groupadd --gid 10001 workspace && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin workspace
WORKDIR /app
COPY --from=build --chown=root:root /src/package.json ./package.json
COPY --from=build --chown=root:root /src/node_modules ./node_modules
COPY --from=build --chown=root:root /src/dist ./dist
COPY --from=build --chown=root:root /src/skills ./skills
ENV NODE_ENV=production
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/cli.js", "workspace"]
