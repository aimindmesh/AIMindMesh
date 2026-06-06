FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache git python3 make g++ 

# Clone the repository
RUN git clone https://github.com/tashfeenahmed/freellmapi.git .

RUN npm install
RUN npm audit fix --force || true

# Build client and server
RUN npm run build

# Start the server
EXPOSE 3001
ENV PORT=3001
ENV NODE_ENV=production

CMD ["npm", "run", "start", "-w", "server"]
