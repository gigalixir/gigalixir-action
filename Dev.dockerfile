# Development environment for Gigalixir Deploy Action
FROM node:22-slim

# Install git (needed for testing the action)
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy the rest of the source
COPY . .

# Default command - start a shell for development
CMD ["/bin/bash"]
