# syntax=docker/dockerfile:1

FROM node:16-slim
ENV NODE_ENV=production

WORKDIR /app
COPY . .
# Get ride of useless files ans directories
RUN rm -rf ./node_modules ./.vscode ./.babelrc
RUN rm *.log
RUN rm test.js
RUN rm config.ini.js 

RUN npm install


CMD [ "sh", "-c", "node zibase2mqtt.js" ]
