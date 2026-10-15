FROM node:22-bookworm-slim

# 1. Install dependensi sistem dasar untuk Git, Antigravity CLI, dan build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    procps \
    openssh-client \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 2. Gunakan user non-root 'node' (UID 1000) bawaan image Node.js
USER node
ENV HOME=/home/node
ENV PATH="/home/node/.local/bin:${PATH}"

# 3. Install Antigravity CLI (agy) untuk user node
RUN mkdir -p /home/node/.local/bin /home/node/projects /home/node/.gemini \
    && curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- -d /home/node/.local/bin

WORKDIR /app

# 4. Salin package file dan install dependensi npm
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# 5. Salin source code
COPY --chown=node:node . .

# 6. Siapkan folder data, logs, dan projects
RUN mkdir -p data logs /home/node/projects

ENV NODE_ENV=production
ENV AGY_BIN=/home/node/.local/bin/agy
ENV PROJECTS_FILE=/app/data/projects.json

CMD ["node", "src/bot.js"]
