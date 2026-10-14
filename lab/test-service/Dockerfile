FROM node:22-bookworm-slim
WORKDIR /app
ARG SOURCE_REVISION=local
ARG DEFAULT_FAULT=healthy
ENV NODE_ENV=production LAB_MODE=local SOURCE_REVISION=$SOURCE_REVISION LAB_FAULT=$DEFAULT_FAULT
LABEL org.opencontainers.image.source=https://github.com/NoName4Me/enterprise-app-marketplace
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
LABEL io.marketplace.lab.variant=$DEFAULT_FAULT
COPY --chown=node:node server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
