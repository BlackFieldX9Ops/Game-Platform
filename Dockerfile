# Servidor + app web. Construa a partir da raiz do repositório.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY app/www ./www
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV DB_FILE=/app/data/app.db
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
