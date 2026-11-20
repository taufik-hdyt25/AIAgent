FROM node:26-alpine
ENV NODE_ENV=production PORT=3217 DATA_DIR=/app/data
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY antislop.md ./antislop.md
COPY skills ./skills
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/data && chown -R app:app /app
USER app
EXPOSE 3217
CMD ["node", "src/server.js"]
