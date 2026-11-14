FROM node:22-bookworm-slim

# Install dependencies for yt-dlp, ffmpeg, and native SQLite builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install standalone yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source
COPY . .

# Expose ports
EXPOSE 5050 5051 5052 5053

ENV NODE_ENV=production
ENV PORT=5050

CMD ["node", "server.js"]

