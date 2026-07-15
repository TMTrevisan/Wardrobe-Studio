# Use Node.js 20 base image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy the MCP server configuration
COPY mcp-server/package*.json ./mcp-server/

# Install dependencies specifically inside the mcp-server folder
RUN cd mcp-server && npm ci

# Copy tsconfig and source files for the MCP server
COPY mcp-server/tsconfig.json ./mcp-server/
COPY mcp-server/src ./mcp-server/src

# Build the MCP server
RUN cd mcp-server && npm run build

# Configure environment variables
ENV NODE_ENV=production
ENV PORT=10000

# Expose Render's default port
EXPOSE 10000

# Start the built MCP server
CMD ["node", "mcp-server/build/index.js"]
