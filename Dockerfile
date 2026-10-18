FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LUNA_DATA_DIR=/data

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --system luna \
    && useradd --system --gid luna --home-dir /app luna

COPY app.py core_brain.py voice_engine.py ./
COPY CHANGELOG.md ./CHANGELOG.md
COPY luna_personality.example.txt ./
COPY templates/ ./templates/
COPY static/css/ ./static/css/
COPY static/js/ ./static/js/
COPY static/pwa/ ./static/pwa/
COPY static/images/ ./static/images/
RUN mkdir -p /data /app/static/audio \
    && chown -R luna:luna /app /data

USER luna
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
