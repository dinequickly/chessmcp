# Use Node.js 22 (LTS) as the base image
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package.json and lock file
COPY package*.json ./

# Install dependencies (including production deps)
RUN npm install

# Copy source code and config
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
