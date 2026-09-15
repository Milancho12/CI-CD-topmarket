FROM ghcr.io/puppeteer/puppeteer:21.9.0

WORKDIR /app

USER root

COPY package*.json ./

RUN npm install

# Create symlink for bundled Chrome
RUN ln -s $(find /home/pptruser/.cache/puppeteer/chrome -name "chrome" -type f | head -n 1) /usr/bin/google-chrome-stable

COPY . .

RUN chown -R pptruser:pptruser /app

EXPOSE 3001

CMD ["node", "worker.js"]
