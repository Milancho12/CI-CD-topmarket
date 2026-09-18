FROM ghcr.io/puppeteer/puppeteer:21.9.0

WORKDIR /app

USER root

COPY package*.json ./

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN npm install --ignore-scripts

COPY . .

RUN chown -R pptruser:pptruser /app

EXPOSE 3001

CMD ["node", "worker.js"]
