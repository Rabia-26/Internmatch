import { logger } from "./logger";

/**
 * Optional Python OCR microservice (see /ocr_api).
 * Set OCR_API_URL e.g. http://localhost:8000/extract
 */
export async function extractWithPythonOcr(file: File): Promise<string> {
  const base = process.env.OCR_API_URL;
  if (!base) {
    throw new Error("OCR_API_URL not configured");
  }

  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch(base, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error("[OCR] Python service error:", text);
    throw new Error("Python OCR failed");
  }

  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (!text) throw new Error("OCR_RETURNED_EMPTY_TEXT");
  return text;
}
