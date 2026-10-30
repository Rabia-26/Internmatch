export const AI_MESSAGE_LIMIT = 15;
export const UPLOAD_DOCUMENT_LIMIT = 1;
export const FINDINGS_LIMIT = 24;

export const WATCHDOC_LIMIT_COPY = `You've reached the current limit for this demo.

Try again later, or start a fresh search from the upload page.`;

export type WatchDocLimitCode =
  | "ai_messages_limit"
  | "upload_document_limit"
  | "findings_limit";

export function createLimitPayload(code: WatchDocLimitCode) {
  return {
    limitReached: true,
    code,
    title: "InternMatch limit reached",
    message: WATCHDOC_LIMIT_COPY,
  } as const;
}

export function limitFindings<T extends { findings: unknown[] }>(
  groups: T[],
  limit = FINDINGS_LIMIT,
) {
  let remaining = limit;

  return groups
    .map((group) => {
      if (remaining <= 0) {
        return {
          ...group,
          findings: [],
        };
      }

      const nextFindings = group.findings.slice(0, remaining);
      remaining -= nextFindings.length;

      return {
        ...group,
        findings: nextFindings,
      };
    })
    .filter((group) => group.findings.length > 0);
}
