FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# The OCR + RULE-001~020 engine (./ocr, mounted at /ocr) runs as a Node subprocess. It has
# no npm dependencies, so only the runtime binary is needed.
COPY --from=node:20-slim /usr/local/bin/node /usr/local/bin/node

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p /app/storage/receipts

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

