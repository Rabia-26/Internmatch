/**
 * Native (in-process) text normalization.
 *
 *   .txt   → read bytes
 *   .docx  → mammoth (XML)
 *   .pdf   → try pdf-parse text layer; only fall back to OCR if it's empty.
 *   .doc   → mammoth (best-effort; older binary .doc may fail)
 *
 * No external HTTP service required.
 */

import { logger } from "./logger";
import { extractWithPythonOcr } from "./ocrPython";

const TXT_DECODER = new TextDecoder("utf-8");

async function fileToBuffer(file: File): Promise<Buffer> {
  const ab = await file.arrayBuffer();
  return Buffer.from(ab);
}

function getExtension(file: File): string {
  const idx = file.name.lastIndexOf(".");
  return idx >= 0 ? file.name.slice(idx + 1).toLowerCase() : "";
}

async function extractTxt(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  return TXT_DECODER.decode(ab);
}

async function extractDocx(file: File): Promise<string> {
  const buf = await fileToBuffer(file);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: buf });
  return (result.value ?? "").trim();
}

async function extractPdf(file: File): Promise<string> {
  const buf = await fileToBuffer(file);

  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buf });
    try {
      const result = await parser.getText();
      const text = (result?.text ?? "").trim();
      if (text.length > 0) return text;
    } finally {
      await parser.destroy();
    }
  } catch (err) {
    logger.warn(`[OCR] pdf-parse failed, trying OCR fallback:`, err);
  }

  if (process.env.OCR_API_URL) {
    logger.info(`[OCR] Falling back to Python OCR for PDF`);
    try {
      return await extractWithPythonOcr(file);
    } catch (ocrErr) {
      logger.error(`[OCR] Python OCR fallback failed:`, ocrErr);
    }
  }
  return "";
}

export async function normalization(file: File): Promise<string> {
  const ext = getExtension(file);
  logger.info(`[OCR] Normalizing "${file.name}" (.${ext}, ${file.size} bytes)`);

  let text = "";
  try {
    switch (ext) {
      case "txt":
        text = await extractTxt(file);
        break;
      case "docx":
      case "doc":
        text = await extractDocx(file);
        break;
      case "pdf":
        text = await extractPdf(file);
        break;
      default:
        throw new Error(`UNSUPPORTED_FILE_TYPE: .${ext}`);
    }
  } catch (err: unknown) {
    const e = err as { message?: string };
    logger.error(`[OCR] Extraction failed for ${file.name}:`, e?.message ?? e);
    throw err;
  }

  if (!text || text.trim().length === 0) {
    throw new Error("OCR_RETURNED_EMPTY_TEXT");
  }

  logger.info(`[OCR] "${file.name}" → ${text.length} chars`);
  return text;
}
