# Multi-stage build. Cloud Run uses this automatically when a Dockerfile is
# present, which is more predictable than buildpack autodetection.
FROM node:22-slim AS build
WORKDIR /app

# Dev dependencies are needed here: vite, esbuild and typescript all run at build
# time. They are left behind in the runtime stage.
# `npm ci` rather than `npm install`: it installs exactly what the lockfile pins
# and fails loudly if package.json and the lockfile have drifted apart, which is
# what you want in a build you are not watching.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run typecheck && npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only production dependencies reach the final image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

# Cloud Run injects PORT; the server reads it and falls back to 3000 locally.
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "dist/server.cjs"]
