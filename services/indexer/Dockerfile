FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY services/indexer ./services/indexer

WORKDIR /app/services/indexer

RUN npm ci

CMD ["npm", "start"]
