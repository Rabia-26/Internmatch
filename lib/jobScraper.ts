import { logger } from "./logger";

export type JobListing = {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  source: string;
};

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
};

const PER_SOURCE_TIMEOUT_MS = 18_000;
const MAX_PER_SOURCE = 6;

export type ScrapeSource = {
  id: string;
  name: string;
};

export const SCRAPE_SOURCES: ScrapeSource[] = [
  { id: "internshala", name: "Internshala" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "wellfound", name: "Wellfound" },
  { id: "naukri", name: "Naukri" },
];

function humanize(part: string): string {
  return part
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildQuery(keywords: string[]): string {
  return keywords.slice(0, 6).join(" ").trim() || "internship";
}

function parseInternshalaDetailSlug(slug: string): {
  title: string;
  company: string;
  location: string;
} {
  const clean = slug.replace(/\/$/, "");
  const m = clean.match(
    /^(.+)-internship-in-(.+?)-at-(.+?)(\d{6,})$/i,
  );
  if (m) {
    return {
      title: `${humanize(m[1])} Internship`,
      company: humanize(m[3].replace(/\d+$/, "")),
      location: humanize(m[2]),
    };
  }
  return {
    title: humanize(clean.slice(0, 80)),
    company: "Internshala",
    location: "India",
  };
}

function parseInternshala(html: string, baseUrl: string): JobListing[] {
  const hrefRe = /href="(\/internship\/detail\/[^"]+)"/g;
  const seen = new Set<string>();
  const out: JobListing[] = [];

  for (const match of html.matchAll(hrefRe)) {
    const path = match[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const slug = path.replace(/^\/internship\/detail\//, "");
    const meta = parseInternshalaDetailSlug(slug);
    out.push({
      title: meta.title,
      company: meta.company,
      location: meta.location,
      url: `${baseUrl}${path}`,
      description: `Internshala listing · ${meta.company}`,
      source: "Internshala",
    });
    if (out.length >= MAX_PER_SOURCE) break;
  }
  return out;
}

function parseLinkedInGuest(html: string): JobListing[] {
  const blockRe =
    /<a class="base-card__full-link[^"]*" href="([^"]+)"[\s\S]*?<span class="sr-only">\s*([\s\S]*?)<\/span>[\s\S]*?base-search-card__subtitle[\s\S]*?>\s*([\s\S]*?)<\/a>[\s\S]*?job-search-card__location">\s*([\s\S]*?)<\/span>/g;
  const out: JobListing[] = [];
  for (const m of html.matchAll(blockRe)) {
    const url = m[1].replace(/&amp;/g, "&");
    const title = m[2].replace(/\s+/g, " ").trim();
    const company = m[3]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const location = m[4].replace(/\s+/g, " ").trim();
    if (!title || !url) continue;
    out.push({
      title,
      company: company || "Company",
      location: location || "India",
      url,
      description: `${company} · ${location}`,
      source: "LinkedIn",
    });
    if (out.length >= MAX_PER_SOURCE) break;
  }
  return out;
}

function parseWellfound(html: string, base: string): JobListing[] {
  const titleRe = /"title":"((?:\\.|[^"\\])*)"/g;
  const hrefRe = /href="(\/jobs\/(\d+)-[^"]+)"/g;
  const titles: string[] = [];
  for (const m of html.matchAll(titleRe)) {
    const t = m[1]
      .replace(/\\u0026/g, "&")
      .replace(/\\"/g, '"')
      .trim();
    if (t.length > 4 && !titles.includes(t)) titles.push(t);
  }

  const out: JobListing[] = [];
  let ti = 0;
  const seen = new Set<string>();
  for (const m of html.matchAll(hrefRe)) {
    const path = m[1];
    if (path.includes("signup") || seen.has(path)) continue;
    seen.add(path);
    const title = titles[ti++] ?? humanize(path.split("/").pop()?.replace(/^\d+-/, "") ?? "Role");
    out.push({
      title,
      company: "Startup",
      location: "Remote / Global",
      url: `${base}${path}`,
      description: "Wellfound listing",
      source: "Wellfound",
    });
    if (out.length >= MAX_PER_SOURCE) break;
  }
  return out;
}

function naukriSearchFallback(query: string, location?: string): JobListing[] {
  const params = new URLSearchParams({
    k: query,
    experience: "0",
    seo: "1",
  });
  if (location?.trim()) params.set("location", location.trim());
  const url = `https://www.naukri.com/internship-jobs?${params.toString()}`;
  return [
    {
      title: `Internships: ${query}`,
      company: "Naukri",
      location: location?.trim() || "India",
      url,
      description: "Open Naukri search results for these keywords.",
      source: "Naukri",
    },
  ];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(PER_SOURCE_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) {
      logger.warn(`[SCRAPE] HTTP ${res.status} for ${url}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    logger.warn(`[SCRAPE] Fetch failed ${url}:`, err);
    return null;
  }
}

function internshalaSearchUrl(keywords: string[]): string {
  const slug = keywords
    .slice(0, 4)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug
    ? `https://internshala.com/internships/keywords-${slug}`
    : "https://internshala.com/internships";
}

async function scrapeInternshala(
  keywords: string[],
  _location?: string,
): Promise<JobListing[]> {
  const url = internshalaSearchUrl(keywords);
  logger.info(`[SCRAPE] Internshala ${url}`);
  const html = await fetchText(url);
  if (!html) return [];
  return parseInternshala(html, "https://internshala.com");
}

async function scrapeLinkedIn(
  keywords: string[],
  location?: string,
): Promise<JobListing[]> {
  const params = new URLSearchParams({
    keywords: buildQuery(keywords),
    location: location?.trim() || "India",
    start: "0",
  });
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;
  logger.info(`[SCRAPE] LinkedIn guest API`);
  const html = await fetchText(url);
  if (!html) return [];
  return parseLinkedInGuest(html);
}

async function scrapeWellfound(keywords: string[]): Promise<JobListing[]> {
  const q = encodeURIComponent(buildQuery(keywords));
  const url = `https://wellfound.com/jobs?q=${q}`;
  logger.info(`[SCRAPE] Wellfound ${url}`);
  const html = await fetchText(url);
  if (!html) return [];
  return parseWellfound(html, "https://wellfound.com");
}

async function scrapeNaukri(
  keywords: string[],
  location?: string,
): Promise<JobListing[]> {
  const query = buildQuery(keywords);
  const params = new URLSearchParams({ k: query, experience: "0" });
  const url = `https://www.naukri.com/internship-jobs?${params.toString()}`;
  logger.info(`[SCRAPE] Naukri ${url}`);
  const html = await fetchText(url);
  if (!html || html.includes("Loading search results")) {
    return naukriSearchFallback(query, location);
  }
  const titleRe = /title="([^"]{10,120})"/g;
  const out: JobListing[] = [];
  for (const m of html.matchAll(titleRe)) {
    const title = m[1];
    if (!/intern|engineer|developer|analyst|design/i.test(title)) continue;
    out.push({
      title,
      company: "Naukri",
      location: location?.trim() || "India",
      url,
      description: "From Naukri search page",
      source: "Naukri",
    });
    if (out.length >= MAX_PER_SOURCE) break;
  }
  return out.length ? out : naukriSearchFallback(query, location);
}

/** Keyword overlap score — higher = better match for ranking. */
export function scoreListingMatch(
  listing: JobListing,
  keywords: string[],
): number {
  const hay =
    `${listing.title} ${listing.company} ${listing.location} ${listing.description}`.toLowerCase();
  let score = 0;
  for (const raw of keywords) {
    const kw = raw.toLowerCase().trim();
    if (kw.length < 2) continue;
    if (hay.includes(kw)) score += kw.length >= 6 ? 4 : 2;
    else {
      for (const part of kw.split(/\s+/)) {
        if (part.length >= 3 && hay.includes(part)) score += 1;
      }
    }
  }
  if (/intern/i.test(listing.title)) score += 1;
  return score;
}

export function rankListings(
  listings: JobListing[],
  keywords: string[],
): JobListing[] {
  return [...listings].sort(
    (a, b) =>
      scoreListingMatch(b, keywords) - scoreListingMatch(a, keywords),
  );
}

export async function scrapeInternshipsFromBoards(params: {
  keywords: string[];
  location?: string;
  onSourceStart?: (sourceId: string, index: number, total: number) => void;
}): Promise<JobListing[]> {
  const { keywords, location, onSourceStart } = params;
  const total = SCRAPE_SOURCES.length;

  const runners: Record<string, () => Promise<JobListing[]>> = {
    internshala: () => scrapeInternshala(keywords, location),
    linkedin: () => scrapeLinkedIn(keywords, location),
    wellfound: () => scrapeWellfound(keywords),
    naukri: () => scrapeNaukri(keywords, location),
  };

  const batches = await Promise.all(
    SCRAPE_SOURCES.map(async (source, index) => {
      onSourceStart?.(source.id, index, total);
      try {
        const rows = await runners[source.id]();
        logger.info(`[SCRAPE] ${source.id} → ${rows.length} listings`);
        return rows;
      } catch (err) {
        logger.error(`[SCRAPE] ${source.id} error:`, err);
        return [];
      }
    }),
  );

  const merged = rankListings(batches.flat(), keywords);
  return merged.slice(0, 24);
}
