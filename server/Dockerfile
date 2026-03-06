FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DAIERYOU_WS_PORT=3014

EXPOSE 3014

CMD ["npm", "start"]
