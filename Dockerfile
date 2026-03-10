FROM node:18-slim

# Install necessary system dependencies for running Chromium (puppeteer)
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

# Ensure puppeteer downloads Chromium during install
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

# Install Node dependencies (runs postinstall which installs puppeteer browsers)
COPY package*.json ./
RUN npm ci --production --no-optional

# Copy app source
COPY . .

# Prepare a persistent Puppeteer user-data directory and set ownership
RUN mkdir -p /home/node/puppeteer_data \
	&& chown -R node:node /home/node/puppeteer_data /app

# Run as non-root `node` user
USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Start the server with the File polyfill preloaded
CMD ["node", "-r", "./polyfill.cjs", "server.js"]

