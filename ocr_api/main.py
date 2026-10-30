"""
Lightweight OCR/text extraction service for InternMatch resumes.
Run: uvicorn main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import io
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="InternMatch OCR API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def extract_pdf_text(data: bytes) -> str:
    try:
        import pdfplumber

        parts: list[str] = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                parts.append(page.extract_text() or "")
        return "\n".join(parts).strip()
    except Exception:
        return ""


def extract_docx_text(data: bytes) -> str:
    try:
        import docx

        doc = docx.Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs).strip()
    except Exception:
        return ""


def ocr_pdf_pages(data: bytes) -> str:
    """OCR scanned/image PDFs page-by-page (PyMuPDF + Tesseract)."""
    try:
        import fitz
        import pytesseract
        from PIL import Image

        parts: list[str] = []
        with fitz.open(stream=data, filetype="pdf") as doc:
            for page in doc:
                pix = page.get_pixmap(dpi=200)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                page_text = pytesseract.image_to_string(img).strip()
                if page_text:
                    parts.append(page_text)
        return "\n".join(parts).strip()
    except Exception:
        return ""


def ocr_image(data: bytes) -> str:
    try:
        from PIL import Image
        import pytesseract

        image = Image.open(io.BytesIO(data))
        return pytesseract.image_to_string(image).strip()
    except Exception:
        return ""


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    name = (file.filename or "").lower()
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    text: Optional[str] = None
    if name.endswith(".pdf"):
        text = extract_pdf_text(data)
        if not text:
            text = ocr_pdf_pages(data)
    elif name.endswith(".docx"):
        text = extract_docx_text(data)
    elif name.endswith(".txt"):
        text = data.decode("utf-8", errors="ignore").strip()
    else:
        text = ocr_image(data)

    if not text:
        raise HTTPException(status_code=422, detail="Could not extract text")

    return {"text": text}
