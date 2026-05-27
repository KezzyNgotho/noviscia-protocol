FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY services/websocket ./services/websocket

WORKDIR /app/services/websocket

RUN npm ci

EXPOSE 8080

CMD ["npm", "start"]
