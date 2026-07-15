# Use the official lightweight Node.js 20 image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package configuration
COPY package*.json ./

# Install dependencies (production-ready)
RUN npm ci

# Copy the rest of the application code
COPY tsconfig.json ./
COPY src ./src

# Build the TypeScript project
RUN npm run build

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=10000

# Expose the server port
EXPOSE 10000

# Run the server
CMD ["npm", "start"]
