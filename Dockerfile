# Ask the Satellite - public demo image: pre-computed stories, recorded narrations, no language model, live measuring off.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.lock.txt .
RUN pip install -r requirements.lock.txt
COPY backend backend
COPY web web
# Public host defaults (override in the dashboard): stories only, no model, trust the platform proxy for visitor IPs.
ENV ALLOW_LIVE=0 LLM_MODEL= LLM_FALLBACK= LLM_SMALL= TRUST_PROXY=1 PREWARM=0 WEB_CONCURRENCY=2 THREADS=200
RUN useradd -m app && chown -R app /app/backend/cache
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:%s/api/presets' % os.environ.get('PORT','8000'), timeout=4)"
CMD ["sh", "-c", "uvicorn main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-2} --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 15"]
