# Production image: builds the app, then on every start applies migrations/bootstrap and serves on $PORT.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app /app
EXPOSE 3000
# db:bootstrap is idempotent: migrations + defaults + first Director (only if no users exist)
CMD ["npm", "run", "start:prod"]
