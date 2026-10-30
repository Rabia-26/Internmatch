/** Groq chat model — override with GROQ_MODEL in .env.local */
export const GROQ_CHAT_MODEL =
  process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";
