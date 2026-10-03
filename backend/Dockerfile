# CodeTrackr API (roadmap item 17).
# Small production image: Node 20 on Alpine, production dependencies only,
# runs as the unprivileged `node` user. Configuration comes from environment
# variables at run time (see .env.example); nothing secret is baked in.
#
#   docker build -t codetrackr-api backend
#   docker run --rm -p 5050:5050 --env-file backend/.env codetrackr-api

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first, so source edits do not invalidate this layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

USER node
EXPOSE 5050

# Readiness: /health answers 503 until MongoDB is connected.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5050)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "app.js"]
