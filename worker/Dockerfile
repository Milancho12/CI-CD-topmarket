FROM ghcr.io/puppeteer/puppeteer:21.9.0

WORKDIR /app

USER root

COPY package*.json ./

RUN npm install

COPY . .

RUN chown -R pptruser:pptruser /app

EXPOSE 3001

CMD ["node", "worker.js"]
