FROM node:20-alpine AS builder

WORKDIR /app

COPY client/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY client/ ./
COPY shared/ ../shared/

ARG VITE_WS_URL=ws://localhost:3014
ENV VITE_WS_URL=${VITE_WS_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
