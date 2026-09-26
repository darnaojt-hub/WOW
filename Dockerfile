FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY seed ./seed
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
