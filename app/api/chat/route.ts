import { NextResponse } from "next/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import {
  consumeAiMessageQuota,
  getClaimsByJobId,
  getDifferencesByJobId,
  getJob,
  searchClaimsByEmbedding,
} from "@/lib/db";
import { generateEmbedding } from "@/lib/embeddings";
import { AI_MESSAGE_LIMIT, createLimitPayload } from "@/lib/limits";
import { logger } from "@/lib/logger";
import { GROQ_CHAT_MODEL } from "@/lib/groqModel";

const GROQ_MODEL = GROQ_CHAT_MODEL;
const MAX_HISTORY = 12;
const MAX_MESSAGE_CHARS = 2000;
const RAG_TOP_K = 10;

// 20 chat requests per minute per IP.
const chatLimiter = new RateLimiterMemory({ points: 20, duration: 60 });

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  try {
    const clientKey = getClientIp(req);

    try {
      await chatLimiter.consume(clientKey);
    } catch {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429 },
      );
    }

    const body = await req.json();
    const jobId: string | undefined = body?.jobId;
    const messages: IncomingMessage[] = Array.isArray(body?.messages)
      ? body.messages
      : [];

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }
    if (messages.length === 0) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }

    // Sanitize/cap message lengths to prevent token blowups.
    const safeMessages = messages
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
      .map((m) => ({
        role: m.role,
        content: m.content.slice(0, MAX_MESSAGE_CHARS),
      }));
    if (safeMessages.length === 0) {
      return NextResponse.json(
        { error: "messages must contain user/assistant content" },
        { status: 400 },
      );
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Groq API key not configured on server." },
        { status: 500 },
      );
    }

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status !== "completed") {
      return NextResponse.json({
        reply:
          "This job is still processing. Wait until matching completes, then ask again.",
      });
    }

    const quota = await consumeAiMessageQuota(clientKey, AI_MESSAGE_LIMIT, 1);

    if (!quota.allowed) {
      return NextResponse.json(createLimitPayload("ai_messages_limit"), {
        status: 429,
      });
    }

    // --- RAG: retrieve relevant claims via vector similarity ---
    const lastUserMsg = safeMessages
      .slice()
      .reverse()
      .find((m) => m.role === "user");
    const queryText = lastUserMsg?.content ?? "";

    let claims;
    try {
      const queryEmbedding = await generateEmbedding(queryText);
      const ragClaims = await searchClaimsByEmbedding(
        jobId,
        queryEmbedding,
        RAG_TOP_K,
      );
      // Fallback to recent claims if vector search returns nothing.
      claims =
        ragClaims.length > 0
          ? ragClaims
          : await getClaimsByJobId(jobId).then((all) => all.slice(-RAG_TOP_K));
    } catch (ragErr) {
      logger.warn(
        "[CHAT] RAG retrieval failed, falling back to full dump",
        ragErr,
      );
      claims = await getClaimsByJobId(jobId);
    }

    // Always include contradictions — they are critical context regardless of question.
    const differences = await getDifferencesByJobId(jobId);
    const contradictions = differences.filter((d) => d.contradiction);

    const claimsSummary = claims
      .map(
        (c, i) =>
          `[C${i + 1}] (${c.claimType ?? "claim"}, ${c.docId}) ${c.claimText}`,
      )
      .join("\n");

    const diffSummary = contradictions
      .slice(0, 10)
      .map(
        (d, i) =>
          `[D${i + 1}] ${d.type ?? "diff"} | A: "${d.claimAText ?? ""}" | B: "${d.claimBText ?? ""}" | Explanation: ${d.explanation ?? ""}`,
      )
      .join("\n");

    const totalClaims = claims.length;
    const totalDiffs = contradictions.length;

    const systemPrompt = `You are InternMatch's internship matching assistant.
You answer questions about internship matches, keywords, and job listings from the user's search results. If the answer isn't supported by the provided context, say so honestly.

Be concise (2-5 sentences unless asked for more). Use plain English. When referencing specific claims, quote them briefly.

=== RELEVANT CLAIMS (${totalClaims} retrieved via semantic search) ===
${claimsSummary || "(no relevant claims found)"}

=== DETECTED CONTRADICTIONS (${totalDiffs} total, showing top ${Math.min(10, totalDiffs)}) ===
${diffSummary || "(no contradictions detected)"}`;

    const trimmedHistory = safeMessages.slice(-MAX_HISTORY);

    const upstream = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.2,
          max_tokens: 600,
          messages: [
            { role: "system", content: systemPrompt },
            ...trimmedHistory,
          ],
        }),
      },
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      logger.error(`[CHAT] Groq error ${upstream.status}: ${errText}`);
      return NextResponse.json(
        { error: `Groq API error: ${upstream.status}` },
        { status: 500 },
      );
    }

    const json = await upstream.json();
    const reply: string =
      json?.choices?.[0]?.message?.content?.trim() ??
      "Sorry, I couldn't generate a response.";

    return NextResponse.json({ reply });
  } catch (err: any) {
    logger.error("[CHAT] route error", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 },
    );
  }
}
