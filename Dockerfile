# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./

RUN npm install

COPY src ./src

RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

RUN npm install --production

# Non-root user for security
USER node

# Default environment variables (can be overridden)
ENV DB_PORT=1433
ENV DB_ENCRYPT=false
ENV DB_TRUST_CERT=true

# Entry point
CMD ["node", "dist/index.js"]
