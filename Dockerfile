FROM node:20-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install server dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Install client dependencies and build
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install

COPY client/ ./client/
RUN cd client && npm run build

# Copy server code
COPY server/ ./server/
COPY CLAUDE.md REQUIREMENTS.md ./

# Create data directory
RUN mkdir -p /app/data/audio

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=5100

EXPOSE 5100

CMD ["node", "server/index.js"]
