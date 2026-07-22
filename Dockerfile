FROM node:22-bookworm-slim

WORKDIR /opt/ai-web-test
COPY package.json ./
RUN npm install
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["help"]
