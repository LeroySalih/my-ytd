FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json ./

# Install yt-dlp and production dependencies
RUN apk add --no-cache yt-dlp && npm ci --omit=dev

# Copy application source
COPY src/ ./src/

# Run as non-root user (built into node:alpine image)
USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
