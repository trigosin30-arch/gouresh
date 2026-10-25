# Ankit Stationery Mart — single-container image (API + compiled SPA).
# Stage 1 builds the React app; stage 2 runs FastAPI and serves the build.

FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_ENV=production \
    FRONTEND_DIST=/app/frontend/dist \
    UPLOAD_DIR=/app/data/uploads \
    PORT=8000

WORKDIR /app
RUN useradd --create-home --uid 10001 app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY --from=web /build/dist frontend/dist

RUN mkdir -p /app/data/uploads && chown -R app:app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+__import__('os').environ.get('PORT','8000')+'/healthz', timeout=4).status == 200 else 1)"

# Migrations run on every boot; they are idempotent. Then serve on $PORT.
CMD ["sh", "-c", "cd /app/backend && alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
