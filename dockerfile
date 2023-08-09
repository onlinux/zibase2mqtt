# syntax=docker/dockerfile:1

FROM node:16-slim
ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

#RUN npm install

COPY . .

#CMD [ "sh", "-c", "node zibase2mqtt.js > zibase.log 2>&1" ]

CMD [ "sh", "-c", "node zibase2mqtt.js" ]
