# ---- Build Stage ----
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build the application
RUN bun run build

# ---- Production Stage ----
FROM oven/bun:1-alpine AS runner

WORKDIR /app

# Install wget for healthcheck
RUN apk add --no-cache wget

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

# Copy built application from builder
COPY --from=builder --chown=appuser:appgroup /app/build ./build
COPY --from=builder --chown=appuser:appgroup /app/package.json ./

# Install tailscale
RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community tailscale \
	&& apk add curl \
	&& mkdir /var/run/tailscale && chown 1001:1001 /var/run/tailscale
COPY tailscale-startup.sh /tailscale-startup.sh
RUN chmod +x /tailscale-startup.sh

# Switch to non-root user
USER appuser

# Expose port (SvelteKit node adapter defaults to 3000)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Data directory should be mounted as volume for persistence
VOLUME ["/app/data"]

RUN ls -l / 

# Run the application
ENTRYPOINT [ "/tailscale-startup.sh" ]
CMD ["bun", "build/index.js"]
