FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY services/price-feed ./services/price-feed

WORKDIR /app/services/price-feed

RUN npm ci

CMD ["npm", "start"]
