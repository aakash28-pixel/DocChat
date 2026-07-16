# DocChat frontend — build static assets, serve with nginx.
# Only needed for the VPS / container path. On Vercel/Netlify you don't use
# this: point them at rag-frontend/, build cmd "npm run build", output "dist".
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Vite bakes VITE_* vars at build time — pass them as build args
ARG VITE_API_BASE
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_SENTRY_DSN
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
