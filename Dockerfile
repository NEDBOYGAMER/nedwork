FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/instance

EXPOSE 8000

# waitress serves the app; the shared WebSocket relay (TierForge rooms +
# /ws/notifications) runs beside it on internal port 5001 (not EXPOSE'd, so
# nginx-proxy still auto-detects 8000 as the HTTP port). Nginx proxies both
# relay paths to 5001 with Upgrade headers.
CMD ["waitress-serve", "--host=0.0.0.0", "--port=8000", "--call", "app:create_app"]
