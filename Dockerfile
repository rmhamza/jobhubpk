
FROM node:22-bookworm-slim

WORKDIR /app

# Install native compilation tools for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy project files
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/app.db

VOLUME /data

EXPOSE 3000

HEALTHCHECK CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
