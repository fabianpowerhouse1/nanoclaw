FROM node:22-bullseye

# Install Docker CLI and build tools
RUN apt-get update && apt-get install -y docker.io python3 make g++ curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install --include=dev

# Copy source and compile
COPY . .
RUN npm run build

# Default command
CMD ["npm", "start"]
