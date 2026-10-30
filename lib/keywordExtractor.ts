import { logger } from "./logger";
import { GROQ_CHAT_MODEL } from "./groqModel";

export type ExtractedProfile = {
  keywords: string[];
  skills: string[];
  roleHints: string[];
  summary: string;
};

const DEFAULT_KEYWORDS = ["internship", "entry level"];

function parseJsonFromContent(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Failed to parse keyword JSON from model");
  }
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "your",
  "have",
  "this",
  "that",
  "will",
  "are",
  "was",
  "were",
  "been",
  "about",
  "email",
  "phone",
  "linkedin",
  "github",
  "resume",
  "curriculum",
  "vitae",
]);

export function fallbackKeywordsFromText(resumeText: string): ExtractedProfile {
  const tokens = resumeText
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && w.length <= 24 && !STOP.has(w));

  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);

  return {
    keywords: keywords.length > 0 ? keywords : DEFAULT_KEYWORDS,
    skills: keywords.slice(0, 8),
    roleHints: [],
    summary: "Keywords inferred locally (Groq unavailable).",
  };
}

export async function extractKeywordsFromResume(
  resumeText: string,
  apiKey: string,
): Promise<ExtractedProfile> {
  const snippet = resumeText.slice(0, 12000);
  const model = GROQ_CHAT_MODEL;

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You extract internship search signals from resumes. Return JSON with keys: keywords (string[], max 12, lowercase), skills (string[]), roleHints (string[]), summary (one sentence). Focus on technologies, domains, and intern-friendly roles.",
          },
          {
            role: "user",
            content: snippet,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    logger.error("[KEYWORDS] Groq error:", errText);
    return fallbackKeywordsFromText(resumeText);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  const parsed = parseJsonFromContent(content) as Partial<ExtractedProfile>;

  const keywords = (parsed.keywords ?? [])
    .map((k) => String(k).trim().toLowerCase())
    .filter(Boolean);

  return {
    keywords: keywords.length > 0 ? keywords : DEFAULT_KEYWORDS,
    skills: (parsed.skills ?? []).map(String),
    roleHints: (parsed.roleHints ?? []).map(String),
    summary: parsed.summary ?? "Profile parsed from resume.",
  };
}

export function mergeKeywords(
  manual: string[],
  extracted: string[],
  roleFit?: string,
): string[] {
  const set = new Set<string>();
  for (const k of [...manual, ...extracted]) {
    const v = k.trim().toLowerCase();
    if (v) set.add(v);
  }
  if (roleFit) set.add(roleFit.trim().toLowerCase());
  set.add("internship");
  return Array.from(set).slice(0, 20);
}

export function parseManualKeywords(input: string): string[] {
  return input
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
