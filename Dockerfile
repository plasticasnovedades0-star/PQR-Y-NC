FROM node:20-slim

# better-sqlite3: binarios precompilados; si no, compila
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=10000

RUN mkdir -p /app/data/uploads
VOLUME ["/app/data"]

EXPOSE 10000
CMD ["node", "server.js"]
