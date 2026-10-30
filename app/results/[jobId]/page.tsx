"use client";

import { useEffect, useState, useCallback, useMemo, type ComponentType } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  Upload,
  FileText,
  Sparkles,
  Loader2,
  ExternalLink,
  Building2,
  MapPin,
  Briefcase,
  Target,
} from "lucide-react";

import {
  getKeywordHitsByField,
  getMatchedKeywords,
  matchPercent,
  scoreListingMatch,
  type ScorableListing,
} from "@/lib/listingMatchScore";
import { COLORS as THEME } from "@/lib/theme";

// Local alias keeps the existing references in this file readable.
// All state colors collapse into monochrome intensity.
const COLORS = {
  bg: THEME.bg,
  card: THEME.card,
  cardElev: THEME.cardElev,
  bgElev: THEME.bgElev,
  border: THEME.border,
  borderStrong: THEME.borderStrong,
  primary: THEME.accent, // CTA / accent
  text: THEME.text,
  textMuted: THEME.textMuted,
  textDim: THEME.textDim,
  success: THEME.state.success,
  warning: THEME.state.warning,
  critical: THEME.state.critical,
} as const;

/** Subtle board accents on the dark UI (hackathon polish). */
const SOURCE_ACCENT: Record<string, string> = {
  Internshala: "#22C55E",
  LinkedIn: "#38BDF8",
  Wellfound: "#F472B6",
  Naukri: "#A78BFA",
  "Naukri.com": "#A78BFA",
};

const MATCH_HIGH = "#34D399";
const MATCH_MID = "#FBBF24";

interface Finding {
  id: string;
  type: "green" | "yellow" | "red";
  matchScore?: number;
  claimA: { document: string; clause: string; text: string };
  claimB?: { document: string; clause: string; text: string };
  explanation: string;
}

type GroupSummary = {
  contradictions: number;
  changes: number;
  obligations: number;
  scope: number;
};

type Group = {
  docId: string;
  name?: string;
  summary: GroupSummary;
  findings: Finding[];
};

type Stage =
  | "queued"
  | "ocr"
  | "structure"
  | "claims"
  | "differences"
  | "completed"
  | "failed";

type ApiResult = {
  jobId: string | null;
  status: "processing" | "completed" | "failed" | "idle" | "error";
  stage?: Stage;
  result: {
    groups?: Group[];
    profile?: { keywords?: string[] };
    documents?: unknown[];
    summary?: {
      totalClaims?: number;
      totalDocuments?: number;
      totalContradictions?: number;
      totalChanges?: number;
    };
  } | null;
  progress?: {
    searchBoard?: string;
    searchProgress?: string;
  } | null;
  error?: string | null;
  completedAt?: number | null;
  createdAt?: number | null;
};

const STAGE_LABELS: Record<Stage, string> = {
  queued: "Queued for matching",
  ocr: "Reading your resume",
  structure: "Parsing profile text",
  claims: "Extracting keywords",
  differences: "TinyFish agents searching job boards",
  completed: "Completed",
  failed: "Failed",
};

const TINYFISH_BOARD_LABELS: Record<string, string> = {
  internshala: "Internshala",
  linkedin: "LinkedIn",
  wellfound: "Wellfound",
  naukri: "Naukri",
};

function tinyfishSearchHint(board?: string, progress?: string) {
  const site = board
    ? (TINYFISH_BOARD_LABELS[board] ?? board)
    : "job boards";
  return `TinyFish agent browsing ${site}${progress ? ` (${progress})` : ""}`;
}

const STAGE_ORDER: Stage[] = [
  "queued",
  "ocr",
  "structure",
  "claims",
  "differences",
  "completed",
];

type ResultSummary = {
  totalClaims: number;
  totalDocuments: number;
  totalContradictions: number;
  totalChanges: number;
};

function sourceAccent(source: string): string {
  return SOURCE_ACCENT[source] ?? "#737373";
}

function matchAccentColor(percent: number): string {
  if (percent >= 70) return MATCH_HIGH;
  if (percent >= 40) return MATCH_MID;
  return COLORS.textMuted;
}

function applyLinkMeta(url: string, source: string) {
  try {
    const parsed = new URL(url);
    return {
      label: `View on ${source}`,
      hostname: parsed.hostname.replace(/^www\./, ""),
    };
  } catch {
    return { label: `View on ${source}`, hostname: source };
  }
}

function listingApplyUrl(finding: Finding): string | null {
  const fromClause = finding.claimB?.clause?.trim();
  if (fromClause?.startsWith("http")) return fromClause;
  const fromText = finding.claimB?.text?.trim();
  if (fromText?.startsWith("http")) return fromText;
  return null;
}

function findingToScorable(finding: Finding): ScorableListing {
  const { title, location } = listingTitleLine(finding);
  const desc = finding.claimB?.text ?? finding.explanation;
  return {
    title,
    company: finding.claimA.clause,
    location,
    description: desc.startsWith("http") ? finding.explanation : desc,
  };
}

function findingScore(finding: Finding, keywords: string[]): number {
  if (typeof finding.matchScore === "number") return finding.matchScore;
  if (keywords.length === 0) return 0;
  return scoreListingMatch(findingToScorable(finding), keywords);
}

function listingTitleLine(finding: Finding): {
  title: string;
  location: string;
} {
  const raw = finding.claimA.text.trim();
  const sep = raw.indexOf(" — ");
  if (sep === -1) return { title: raw, location: "India" };
  return {
    title: raw.slice(0, sep).trim(),
    location: raw.slice(sep + 3).trim() || "India",
  };
}

export default function ResultsPage() {
  const params = useParams();
  const jobId = params?.jobId as string | undefined;

  const [groups, setGroups] = useState<Group[]>([]);
  const [sourceFilter, setSourceFilter] = useState<"all" | string>("all");
  const [matchKeywords, setMatchKeywords] = useState<string[]>([]);
  const allFindings = useMemo(
    () => groups.flatMap((g) => g.findings),
    [groups],
  );
  const filteredFindings = useMemo(() => {
    if (sourceFilter === "all") return allFindings;
    return groups.find((g) => g.docId === sourceFilter)?.findings ?? [];
  }, [allFindings, groups, sourceFilter]);
  const rankedFindings = useMemo(() => {
    return [...filteredFindings].sort(
      (a, b) =>
        findingScore(b, matchKeywords) - findingScore(a, matchKeywords),
    );
  }, [filteredFindings, matchKeywords]);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("queued");
  const [progressHint, setProgressHint] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<ApiResult["status"] | null>(
    "processing",
  );
  const [resultSummary, setResultSummary] = useState<ResultSummary>({
    totalClaims: 0,
    totalDocuments: 0,
    totalContradictions: 0,
    totalChanges: 0,
  });

  const fetchStatus = useCallback(async () => {
    if (!jobId) return;
    if (!hasFetchedOnce) setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/results?jobId=${encodeURIComponent(jobId)}`,
      );
      if (!res.ok) throw new Error(await res.text());
      const data: ApiResult = await res.json();
      setJobStatus(data.status ?? "idle");
      if (data.stage) setStage(data.stage);
      const prog = data.progress;
      if (prog?.searchBoard) {
        setProgressHint(
          tinyfishSearchHint(prog.searchBoard, prog.searchProgress),
        );
      } else {
        setProgressHint(null);
      }

      if (data.status !== "completed") {
        setGroups([]);
        setSelectedFinding(null);
        if (data.status === "failed") {
          setError(data.error ?? "Processing failed");
        }
        setLoading(false);
        return;
      }

      const finalGroups: Group[] = data.result?.groups ?? [];
      const summary: ResultSummary = {
        totalClaims: data.result?.summary?.totalClaims ?? 0,
        totalDocuments:
          data.result?.summary?.totalDocuments ?? finalGroups.length,
        totalContradictions: data.result?.summary?.totalContradictions ?? 0,
        totalChanges: data.result?.summary?.totalChanges ?? 0,
      };
      setResultSummary(summary);
      const keywords = data.result?.profile?.keywords ?? [];
      setMatchKeywords(keywords);
      setGroups(finalGroups);
      setSourceFilter("all");
      const flat = finalGroups.flatMap((g) => g.findings);
      const sorted = [...flat].sort(
        (a, b) => findingScore(b, keywords) - findingScore(a, keywords),
      );
      setSelectedFinding(sorted[0] ?? null);
    } catch (err: any) {
      console.error("Failed to load results", err);
      setError(err?.message ?? String(err));
      setGroups([]);
      setSelectedFinding(null);
      setJobStatus("error");
    } finally {
      setLoading(false);
      setHasFetchedOnce(true);
    }
  }, [jobId, hasFetchedOnce]);

  useEffect(() => {
    if (jobId) fetchStatus();
    else {
      setError("No job ID provided");
      setLoading(false);
    }
  }, [jobId, fetchStatus]);

  useEffect(() => {
    if (["completed", "failed", "error"].includes(jobStatus ?? "")) return;
    const id = setInterval(fetchStatus, 4000);
    return () => clearInterval(id);
  }, [jobStatus, fetchStatus]);

  /* ============== Loading ============== */
  if (loading || jobStatus === "processing") {
    const stageIdx = STAGE_ORDER.indexOf(stage);
    return (
      <main
        className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: COLORS.bg, color: COLORS.text }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-xl w-full text-center"
        >
          <div className="flex justify-center mb-8">
            <div className="relative">
              <div
                className="w-16 h-16 rounded-full animate-spin border-4"
                style={{
                  borderColor: `${COLORS.primary}30`,
                  borderTopColor: COLORS.primary,
                }}
              />
              <Sparkles
                className="w-6 h-6 absolute inset-0 m-auto"
                style={{ color: COLORS.primary }}
              />
            </div>
          </div>
          <h2
            className="text-2xl font-bold mb-2"
            style={{ color: COLORS.text }}
          >
            Finding internships with TinyFish
          </h2>
          <p className="text-sm mb-10" style={{ color: COLORS.textMuted }}>
            {progressHint ?? STAGE_LABELS[stage] ?? "Processing"}
          </p>

          {/* Stage progress */}
          <div
            className="p-6 rounded-2xl border text-left space-y-3"
            style={{
              backgroundColor: COLORS.card,
              borderColor: COLORS.border,
            }}
          >
            {STAGE_ORDER.slice(0, -1).map((s, i) => {
              const isDone = i < stageIdx;
              const isActive = i === stageIdx;
              return (
                <div key={s} className="flex items-center gap-3">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      backgroundColor: isDone
                        ? COLORS.success
                        : isActive
                          ? COLORS.primary
                          : COLORS.border,
                    }}
                  >
                    {isDone ? (
                      <CheckCircle
                        className="w-4 h-4"
                        style={{ color: COLORS.text }}
                      />
                    ) : isActive ? (
                      <Loader2
                        className="w-3 h-3 animate-spin"
                        style={{ color: COLORS.text }}
                      />
                    ) : (
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: COLORS.textMuted }}
                      />
                    )}
                  </div>
                  <span
                    className="text-sm"
                    style={{
                      color:
                        isDone || isActive ? COLORS.text : COLORS.textMuted,
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {STAGE_LABELS[s]}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>
      </main>
    );
  }

  /* ============== Error ============== */
  if (jobStatus === "failed" || jobStatus === "error" || error) {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: COLORS.bg, color: COLORS.text }}
      >
        <div className="max-w-md w-full text-center space-y-6">
          <div className="flex justify-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: `${COLORS.critical}1a` }}
            >
              <AlertCircle
                className="w-8 h-8"
                style={{ color: COLORS.critical }}
              />
            </div>
          </div>
          <div>
            <h2
              className="text-2xl font-bold mb-2"
              style={{ color: COLORS.text }}
            >
              Processing failed
            </h2>
            <p className="text-sm" style={{ color: COLORS.textMuted }}>
              {error ?? "An unexpected error occurred."}
            </p>
          </div>
          <Link href="/upload">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="px-6 py-3 rounded-xl font-semibold"
              style={{ backgroundColor: COLORS.primary, color: COLORS.bg }}
            >
              Try again
            </motion.button>
          </Link>
        </div>
      </main>
    );
  }

  const sourceCount = groups.length;

  /* ============== Results UI ============== */
  return (
    <main
      className="min-h-screen flex flex-col pb-16"
      style={{
        backgroundColor: COLORS.bg,
        color: COLORS.text,
        backgroundImage:
          "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(56,189,248,0.08), transparent)",
      }}
    >
      <header
        className="border-b mt-[120px]"
        style={{
          borderColor: COLORS.border,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)",
        }}
      >
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4 min-w-0">
            <Link href="/upload">
              <motion.button
                whileHover={{ x: -2 }}
                whileTap={{ scale: 0.95 }}
                className="w-9 h-9 rounded-lg flex items-center justify-center border"
                style={{
                  borderColor: COLORS.border,
                  backgroundColor: COLORS.cardElev,
                  color: COLORS.textMuted,
                }}
              >
                <ArrowLeft className="w-4 h-4" />
              </motion.button>
            </Link>
            <div className="min-w-0">
              <h1
                className="text-2xl sm:text-3xl font-bold tracking-tight"
                style={{ color: COLORS.text }}
              >
                Your internship matches
              </h1>
              <p className="text-sm mt-1" style={{ color: COLORS.textMuted }}>
                Ranked by keyword fit · TinyFish web search
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Chip
              icon={Briefcase}
              accent="#38BDF8"
              label={`${allFindings.length} listings`}
            />
            <Chip
              icon={FileText}
              accent="#A78BFA"
              label={`${sourceCount} sources`}
            />
            <Chip
              icon={Sparkles}
              accent="#34D399"
              label={`${resultSummary.totalClaims} keywords`}
            />
          </div>
        </div>

        {groups.length > 0 && (
          <div className="max-w-7xl mx-auto px-6 sm:px-8 pb-6 flex items-center gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => {
                setSourceFilter("all");
                const sorted = [...allFindings].sort(
                  (a, b) =>
                    findingScore(b, matchKeywords) -
                    findingScore(a, matchKeywords),
                );
                setSelectedFinding(sorted[0] ?? null);
              }}
              className="px-4 py-2 rounded-full text-sm border whitespace-nowrap transition-all"
              style={{
                borderColor:
                  sourceFilter === "all" ? "#38BDF8" : COLORS.border,
                backgroundColor:
                  sourceFilter === "all"
                    ? "rgba(56,189,248,0.12)"
                    : COLORS.card,
                color: sourceFilter === "all" ? COLORS.text : COLORS.textMuted,
              }}
            >
              All · {allFindings.length}
            </button>
            {groups.map((g) => {
              const src = g.findings[0]?.claimA.document ?? "Source";
              const accent = sourceAccent(src);
              return (
              <button
                key={g.docId}
                type="button"
                onClick={() => {
                  setSourceFilter(g.docId);
                  const sorted = [...g.findings].sort(
                    (a, b) =>
                      findingScore(b, matchKeywords) -
                      findingScore(a, matchKeywords),
                  );
                  setSelectedFinding(sorted[0] ?? null);
                }}
                className="px-4 py-2 rounded-full text-sm border whitespace-nowrap transition-all"
                style={{
                  borderColor:
                    sourceFilter === g.docId ? accent : COLORS.border,
                  backgroundColor:
                    sourceFilter === g.docId
                      ? `${accent}18`
                      : COLORS.card,
                  color:
                    sourceFilter === g.docId ? COLORS.text : COLORS.textMuted,
                }}
              >
                {src} · {g.findings.length}{" "}
                match{g.findings.length === 1 ? "" : "es"}
              </button>
            );
            })}
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-6 sm:px-8 py-10 grid lg:grid-cols-[minmax(0,440px)_1fr] gap-8 lg:gap-10 items-start">
        <div className="space-y-4 lg:sticky lg:top-[148px]">
          <h2
            className="text-xs uppercase tracking-[0.2em] font-semibold px-1"
            style={{ color: COLORS.textMuted }}
          >
            All listings · best match first
          </h2>
          <div className="space-y-3">
            {rankedFindings.length === 0 ? (
              <div
                className="p-6 rounded-xl border text-sm text-center"
                style={{
                  borderColor: COLORS.border,
                  backgroundColor: COLORS.card,
                  color: COLORS.textMuted,
                }}
              >
                No listings in this filter.
              </div>
            ) : (
              rankedFindings.map((finding, idx) => {
                const { title, location } = listingTitleLine(finding);
                const applyUrl = listingApplyUrl(finding);
                const selected = selectedFinding?.id === finding.id;
                const score = findingScore(finding, matchKeywords);
                const pct =
                  matchKeywords.length > 0
                    ? matchPercent(score, matchKeywords)
                    : null;
                const accent = sourceAccent(finding.claimA.document);
                const pctColor =
                  pct !== null ? matchAccentColor(pct) : COLORS.textMuted;
                return (
                  <motion.div
                    key={finding.id}
                    role="button"
                    tabIndex={0}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    onClick={() => setSelectedFinding(finding)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedFinding(finding);
                      }
                    }}
                    whileHover={{ x: 2 }}
                    className="w-full p-5 rounded-2xl border text-left transition-all cursor-pointer"
                    style={{
                      borderColor: selected ? accent : COLORS.border,
                      backgroundColor: selected
                        ? `${accent}14`
                        : COLORS.cardElev,
                      boxShadow: selected
                        ? `0 0 0 1px ${accent}40`
                        : "none",
                    }}
                  >
                    <div className="flex gap-4 items-start">
                      <div
                        className="flex-shrink-0 w-11 h-11 rounded-xl flex flex-col items-center justify-center border"
                        style={{
                          borderColor: `${pctColor}55`,
                          backgroundColor: `${pctColor}12`,
                        }}
                      >
                        <span
                          className="text-[10px] font-mono uppercase"
                          style={{ color: COLORS.textMuted }}
                        >
                          #{idx + 1}
                        </span>
                        {pct !== null ? (
                          <span
                            className="text-xs font-bold"
                            style={{ color: pctColor }}
                          >
                            {pct}%
                          </span>
                        ) : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span
                            className="text-[10px] uppercase tracking-wider font-semibold px-2.5 py-0.5 rounded-full"
                            style={{
                              backgroundColor: `${accent}20`,
                              color: accent,
                            }}
                          >
                            {finding.claimA.document}
                          </span>
                        </div>
                        <p
                          className="text-sm font-semibold line-clamp-2"
                          style={{ color: COLORS.text }}
                        >
                          {title}
                        </p>
                        <p
                          className="text-xs mt-1 truncate"
                          style={{ color: COLORS.textMuted }}
                        >
                          {finding.claimA.clause} · {location}
                        </p>
                      </div>
                      {applyUrl ? (
                        <a
                          href={applyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-opacity hover:opacity-90"
                          style={{
                            backgroundColor: `${accent}25`,
                            color: accent,
                          }}
                          title="Open original listing"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        <div
          className="p-8 sm:p-10 rounded-3xl border"
          style={{
            backgroundColor: COLORS.card,
            borderColor: COLORS.borderStrong,
            minHeight: "60vh",
            boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
          }}
        >
          {selectedFinding ? (
            <ListingDetail
              finding={selectedFinding}
              rank={
                rankedFindings.findIndex((f) => f.id === selectedFinding.id) + 1
              }
              matchKeywords={matchKeywords}
            />
          ) : (
            <div
              className="h-full flex items-center justify-center text-sm"
              style={{ color: COLORS.textMuted }}
            >
              Select a listing to view details.
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto w-full px-6 pb-10 flex flex-col sm:flex-row gap-3">
        <Link href="/upload" className="flex-1">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full h-12 rounded-xl border font-medium flex items-center justify-center gap-2"
            style={{
              borderColor: COLORS.borderStrong,
              color: COLORS.text,
            }}
          >
            <Upload className="w-4 h-4" />
            New search
          </motion.button>
        </Link>
        <Link href="/" className="flex-1">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2"
            style={{
              backgroundColor: COLORS.primary,
              color: COLORS.bg,
            }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </motion.button>
        </Link>
      </div>

    </main>
  );
}

/* ============== Helper components ============== */

function ListingDetail({
  finding,
  rank,
  matchKeywords,
}: {
  finding: Finding;
  rank: number;
  matchKeywords: string[];
}) {
  const { title, location } = listingTitleLine(finding);
  const applyUrl = listingApplyUrl(finding);
  const source = finding.claimA.document;
  const accent = sourceAccent(source);
  const scorable = findingToScorable(finding);
  const score = findingScore(finding, matchKeywords);
  const pct =
    matchKeywords.length > 0 ? matchPercent(score, matchKeywords) : null;
  const pctColor = pct !== null ? matchAccentColor(pct) : COLORS.textMuted;
  const matched = getMatchedKeywords(scorable, matchKeywords);
  const unmatched = matchKeywords.filter(
    (k) => !matched.some((m) => m.toLowerCase() === k.toLowerCase()),
  );
  const fieldHits = getKeywordHitsByField(scorable, matchKeywords);
  const linkMeta = applyUrl ? applyLinkMeta(applyUrl, source) : null;
  const description =
    finding.claimB?.text && !finding.claimB.text.startsWith("http")
      ? finding.claimB.text
      : "Listing discovered via TinyFish web search on this board.";

  return (
    <motion.div
      key={finding.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-xs font-mono font-semibold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: `${accent}22`, color: accent }}
          >
            Rank #{rank > 0 ? rank : "—"}
          </span>
          {pct !== null ? (
            <span
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{
                backgroundColor: `${pctColor}18`,
                color: pctColor,
              }}
            >
              {pct}% match
            </span>
          ) : null}
          <span
            className="text-xs font-semibold px-3 py-1.5 rounded-full uppercase tracking-wide"
            style={{ backgroundColor: `${accent}15`, color: accent }}
          >
            {source}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <h2
          className="text-2xl sm:text-3xl font-bold leading-snug tracking-tight"
          style={{ color: COLORS.text }}
        >
          {title}
        </h2>
        <div
          className="flex flex-wrap gap-x-6 gap-y-2 text-sm"
          style={{ color: COLORS.textMuted }}
        >
          <span className="inline-flex items-center gap-2">
            <Building2 className="w-4 h-4" style={{ color: accent }} />
            {finding.claimA.clause}
          </span>
          <span className="inline-flex items-center gap-2">
            <MapPin className="w-4 h-4" style={{ color: accent }} />
            {location}
          </span>
        </div>
      </div>

      {pct !== null ? (
        <div className="space-y-2">
          <div
            className="flex justify-between text-xs"
            style={{ color: COLORS.textMuted }}
          >
            <span>Keyword fit</span>
            <span style={{ color: pctColor }}>{pct}%</span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: COLORS.bgElev }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                backgroundColor: pctColor,
              }}
            />
          </div>
        </div>
      ) : null}

      <div
        className="p-6 sm:p-7 rounded-2xl border space-y-5"
        style={{
          borderColor: `${MATCH_HIGH}35`,
          background:
            "linear-gradient(145deg, rgba(52,211,153,0.08) 0%, rgba(15,15,15,0.9) 55%)",
        }}
      >
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4" style={{ color: MATCH_HIGH }} />
          <h3
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: COLORS.text }}
          >
            Why it matched
          </h3>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: COLORS.textMuted }}>
          {matched.length > 0 ? (
            <>
              <span style={{ color: COLORS.text }}>
                {matched.length} of {matchKeywords.length}
              </span>{" "}
              profile keywords appear in this posting
              {pct !== null ? (
                <>
                  {" "}
                  (<span style={{ color: pctColor }}>{pct}% overall fit</span>).
                </>
              ) : (
                "."
              )}
            </>
          ) : (
            "This listing matched your search profile from board relevance and role title."
          )}
        </p>
        {matched.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {matched.map((kw) => (
              <span
                key={kw}
                className="text-xs font-medium px-3 py-1.5 rounded-full"
                style={{
                  backgroundColor: "rgba(52,211,153,0.15)",
                  color: MATCH_HIGH,
                  border: "1px solid rgba(52,211,153,0.35)",
                }}
              >
                {kw}
              </span>
            ))}
          </div>
        ) : null}
        {(fieldHits.title.length > 0 ||
          fieldHits.company.length > 0 ||
          fieldHits.description.length > 0) && (
          <ul
            className="text-xs space-y-2 pt-2 border-t"
            style={{ borderColor: COLORS.border, color: COLORS.textDim }}
          >
            {fieldHits.title.length > 0 ? (
              <li>
                <span style={{ color: COLORS.textMuted }}>Title:</span>{" "}
                {fieldHits.title.join(", ")}
              </li>
            ) : null}
            {fieldHits.company.length > 0 ? (
              <li>
                <span style={{ color: COLORS.textMuted }}>Company:</span>{" "}
                {fieldHits.company.join(", ")}
              </li>
            ) : null}
            {fieldHits.description.length > 0 ? (
              <li>
                <span style={{ color: COLORS.textMuted }}>Description:</span>{" "}
                {fieldHits.description.join(", ")}
              </li>
            ) : null}
          </ul>
        )}
        {unmatched.length > 0 && matched.length > 0 ? (
          <p className="text-xs" style={{ color: COLORS.textDim }}>
            Also in your profile (not in this post):{" "}
            {unmatched.slice(0, 8).join(", ")}
            {unmatched.length > 8 ? "…" : ""}
          </p>
        ) : null}
      </div>

      <div
        className="p-6 rounded-2xl border"
        style={{
          backgroundColor: COLORS.bg,
          borderColor: COLORS.border,
        }}
      >
        <h3
          className="text-xs uppercase tracking-widest font-semibold mb-3"
          style={{ color: COLORS.textMuted }}
        >
          About this role
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: COLORS.text }}>
          {description}
        </p>
      </div>

      {applyUrl && linkMeta ? (
        <a
          href={applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-4 p-5 rounded-2xl border transition-opacity hover:opacity-95 group"
          style={{
            borderColor: `${accent}50`,
            backgroundColor: `${accent}12`,
          }}
        >
          <div className="min-w-0">
            <p
              className="text-sm font-semibold flex items-center gap-2"
              style={{ color: COLORS.text }}
            >
              {linkMeta.label}
              <ExternalLink
                className="w-4 h-4 opacity-70 group-hover:opacity-100"
                style={{ color: accent }}
              />
            </p>
            <p className="text-xs mt-1 truncate" style={{ color: COLORS.textMuted }}>
              {linkMeta.hostname}
            </p>
          </div>
          <span
            className="flex-shrink-0 text-xs font-semibold px-4 py-2 rounded-xl"
            style={{ backgroundColor: accent, color: "#0a0a0a" }}
          >
            Apply
          </span>
        </a>
      ) : null}
    </motion.div>
  );
}

function Chip({
  icon: Icon,
  accent,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  accent: string;
  label: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium border"
      style={{
        borderColor: `${accent}40`,
        backgroundColor: `${accent}12`,
        color: accent,
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </div>
  );
}
