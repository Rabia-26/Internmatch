/**
 * Embedding service using @xenova/transformers (ONNX, runs server-side).
 * Default model: all-MiniLM-L6-v2 (384-dim, ~22MB on first download, then cached).
 *
 * Provides:
 *  - generateEmbedding(text) → number[]
 *  - generateEmbeddings(texts) → number[][] (batched)
 *  - cosineSimilarity(a, b) → number in [-1, 1]
 *  - normalize(vec) → unit-length vector (so inner-product == cosine)
 */

import { logger } from "./logger";

type FeatureExtractor = (
  texts: string | string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

const MODEL_NAME = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;

async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      logger.info(`[EMB] Loading embedding model: ${MODEL_NAME}`);
      const start = Date.now();
      // Dynamic import — @xenova/transformers is ESM-only.
      const { pipeline, env } = await import("@xenova/transformers");
      // Allow remote model download on first run; cache locally afterwards.
      env.allowRemoteModels = true;
      env.allowLocalModels = true;
      const extractor = (await pipeline(
        "feature-extraction",
        MODEL_NAME,
      )) as unknown as FeatureExtractor;
      logger.info(`[EMB] Model loaded in ${Date.now() - start}ms`);
      return extractor;
    })();
  }
  return extractorPromise;
}

/**
 * Warm up the embedding model. Call once at server start to avoid
 * first-request latency.
 */
export async function warmupEmbeddings(): Promise<void> {
  await getExtractor();
}

/**
 * Generate a single 384-dim unit-normalized embedding.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || !text.trim()) {
    return new Array(EMBEDDING_DIM).fill(0);
  }
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

/**
 * Batch embedding generation. Returns a [texts.length][EMBEDDING_DIM] array.
 * Internally batched (32 at a time) to avoid memory spikes.
 */
export async function generateEmbeddings(
  texts: string[],
  batchSize = 32,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t || " ");
    const out = await extractor(batch, { pooling: "mean", normalize: true });
    const dim = out.dims[out.dims.length - 1];
    for (let r = 0; r < batch.length; r++) {
      results.push(Array.from(out.data.slice(r * dim, (r + 1) * dim)));
    }
  }
  return results;
}

/**
 * Cosine similarity between two same-length vectors.
 * If both vectors are unit-normalized, this equals their inner product.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dim mismatch ${a.length} vs ${b.length}`,
    );
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * In-place L2 normalization. Returns the same array reference.
 * After normalize, |vec| == 1.
 */
export function normalize(vec: number[]): number[] {
  let n = 0;
  for (let i = 0; i < vec.length; i++) n += vec[i] * vec[i];
  const norm = Math.sqrt(n);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}
