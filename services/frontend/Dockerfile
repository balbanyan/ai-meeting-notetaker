# Frontend Dockerfile for GCP Cloud Run
# Multi-stage build: Node.js for building, nginx for serving

# Stage 1: Build the React application
FROM node:18-alpine AS builder

WORKDIR /app

# Accept build argument for backend URL
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

# Debug: Print the backend URL being used
RUN echo "========================================" && \
    echo "Building frontend with:" && \
    echo "  VITE_BACKEND_URL=${VITE_BACKEND_URL}" && \
    echo "========================================" || true

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application (Vite will use VITE_BACKEND_URL from ENV)
RUN echo "Starting Vite build..." && \
    npm run build && \
    echo "Build complete! Checking output..." && \
    ls -la dist/ || true

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf.default 2>/dev/null || true

# Expose port 8080 (GCP Cloud Run requirement)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

