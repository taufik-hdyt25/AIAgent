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

# 2. Buat user non-root 'coder' (UID 1000) demi keamanan
RUN useradd -m -u 1000 -s /bin/bash coder

# 3. Setup environment untuk user 'coder'
USER coder
ENV HOME=/home/coder
ENV PATH="/home/coder/.local/bin:${PATH}"

# 4. Install Antigravity CLI (agy) untuk user coder
RUN mkdir -p /home/coder/.local/bin /home/coder/projects /home/coder/.gemini \
    && curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- -d /home/coder/.local/bin

WORKDIR /app

# 5. Salin package file dan install dependensi npm
COPY --chown=coder:coder package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# 6. Salin source code
COPY --chown=coder:coder . .

# 7. Siapkan folder data, logs, dan projects
RUN mkdir -p data logs /home/coder/projects

ENV NODE_ENV=production
ENV AGY_BIN=/home/coder/.local/bin/agy
ENV PROJECTS_FILE=/app/data/projects.json

CMD ["node", "src/bot.js"]
