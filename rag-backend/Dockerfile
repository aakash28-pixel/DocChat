# DocChat backend — FastAPI + LangChain + ChromaDB + Tesseract OCR
FROM python:3.11-slim

# System deps: Tesseract for OCR fallback (PyMuPDF ships manylinux wheels,
# no extra system libs needed).
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persistent data lives outside the image on a mounted volume (see compose).
ENV CHROMA_DB_DIR=/data/chroma \
    UPLOAD_DIR=/data/uploads \
    PORT=8000
RUN mkdir -p /data/chroma /data/uploads

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# Single worker: the local ChromaDB store is single-writer. Scale by giving the
# container more CPU, not more workers (see DEPLOYMENT.md → Scaling).
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
