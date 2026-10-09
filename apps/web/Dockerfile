# syntax=docker/dockerfile:1.7
# Build context: REPO ROOT  (docker build -f apps/web/Dockerfile .)
# One image per environment: Vite bakes VITE_* values in at build time (see env/.env.<APP_ENV>).
#   docker build -f apps/web/Dockerfile --build-arg APP_ENV=staging \
#     --build-arg VITE_API_BASE_URL=https://api.example.com/api -t workshop-registration-web:staging .
# nginx reads API_UPSTREAM / DNS_RESOLVER at container start (runtime), not at build time.
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web...
ARG APP_ENV=production
ARG VITE_API_BASE_URL=/api
ARG VITE_APP_NAME=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_APP_NAME=$VITE_APP_NAME
RUN cd apps/web && pnpm exec tsc -b && pnpm exec vite build --mode "$APP_ENV"

FROM nginx:1.27-alpine
# Official image templating: *.template in /etc/nginx/templates -> /etc/nginx/conf.d/*.
# Only these two variables are substituted so nginx's own $variables stay intact.
ENV NGINX_ENVSUBST_FILTER='^(API_UPSTREAM|DNS_RESOLVER)$' \
    API_UPSTREAM=api:3000 \
    DNS_RESOLVER=127.0.0.11
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
