FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/weather-core/package.json packages/weather-core/package.json
COPY web/package.json web/package.json
COPY web-api/package.json web-api/package.json
RUN npm ci --ignore-scripts
COPY packages/weather-core packages/weather-core
COPY web web
COPY web-api web-api
COPY scripts scripts
COPY tsconfig.json ./
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4174 WEB_STATIC_DIR=/app/web/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/web-api/dist web-api/dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4174/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "web-api/dist/server.js"]
