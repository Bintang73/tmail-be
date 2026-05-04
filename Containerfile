FROM oven/bun:1.3.8

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
EXPOSE 3000 2525

CMD ["bun", "src/app.js"]
