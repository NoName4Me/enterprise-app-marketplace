FROM node:22-bookworm-slim
WORKDIR /app
ARG SOURCE_REVISION=local
ENV NODE_ENV=production LAB_MODE=local SOURCE_REVISION=$SOURCE_REVISION
LABEL org.opencontainers.image.source=https://github.com/NoName4Me/enterprise-app-marketplace
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
COPY --chown=node:node server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
