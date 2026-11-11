FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
COPY index.js ./index.js
ENV NODE_ENV=production
USER node
EXPOSE 3100
CMD ["node","index.js"]
