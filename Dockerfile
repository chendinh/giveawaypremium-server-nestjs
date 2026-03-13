# ===== Stage 1: Build =====
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --silent

# Copy source code
COPY . .

# Build NestJS
RUN npm run build


# ===== Stage 2: Production =====
FROM node:20-alpine AS runner

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production --silent

# Copy built files
COPY --from=builder /app/dist ./dist

# Copy templates (used at runtime for email rendering)
COPY --from=builder /app/dist/templates ./dist/templates

# Create tmp directory for file uploads
RUN mkdir -p ./tmp

# Set environment
ENV NODE_ENV=production
ENV PORT=1337

EXPOSE 1337

# Start the server
CMD ["node", "dist/main"]
