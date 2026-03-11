FROM node:18-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
		wget \
		gnupg \
		lsb-release \
		xdg-utils \
		fonts-liberation \
		libnss3 \
		libatk1.0-0 \
		libatk-bridge2.0-0 \
		libcups2 \
		libx11-6 \
		libx11-xcb1 \
		libxcomposite1 \
		libxdamage1 \
		libxrandr2 \
		libxss1 \
		libasound2 \
		libgbm1 \
		libpangocairo-1.0-0 \
		libxext6 \
		libxfixes3 \
		libxtst6 \
		libcairo2 \
		libpango-1.0-0 \
		libgtk-3-0 \
		libgconf-2-4 \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm ci --production --no-optional \
    && npx puppeteer browsers install chrome

COPY . .

RUN mkdir -p /home/node/puppeteer_data \
	&& chown -R node:node /home/node/puppeteer_data /app

USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "-r", "./polyfill.cjs", "server.js"]