FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --legacy-peer-deps
COPY . .
RUN mkdir -p data reports
EXPOSE 3000
CMD ["node", "server.js"]
