FROM node:18-slim

# Install dependencies for Electron
RUN apt-get update && apt-get install -y \
    libgtk-3-0 \
    libgbm-dev \
    libxss1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Run in headless mode
CMD ["npm", "start", "--", "--no-sandbox", "--disable-gpu"]
