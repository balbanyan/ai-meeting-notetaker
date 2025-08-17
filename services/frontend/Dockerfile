FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Build app
RUN npm run build

# Expose port
EXPOSE 3000

# Run app
CMD ["npm", "start"]
