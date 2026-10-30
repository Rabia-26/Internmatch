/** Client-safe keyword overlap scoring (mirrors lib/jobScraper.ts). */

export type ScorableListing = {
  title: string;
  company: string;
  location: string;
  description: string;
};

export function scoreListingMatch(
  listing: ScorableListing,
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

export function maxKeywordScore(keywords: string[]): number {
  let max = 0;
  for (const raw of keywords) {
    const kw = raw.toLowerCase().trim();
    if (kw.length < 2) continue;
    max += kw.length >= 6 ? 4 : 2;
  }
  return Math.max(max, 1);
}

export function matchPercent(score: number, keywords: string[]): number {
  return Math.min(100, Math.round((score / maxKeywordScore(keywords)) * 100));
}

function keywordMatchesInHaystack(kw: string, hay: string): boolean {
  const k = kw.toLowerCase().trim();
  if (k.length < 2) return false;
  if (hay.includes(k)) return true;
  return k.split(/\s+/).some((part) => part.length >= 3 && hay.includes(part));
}

export function getMatchedKeywords(
  listing: ScorableListing,
  keywords: string[],
): string[] {
  const hay =
    `${listing.title} ${listing.company} ${listing.location} ${listing.description}`.toLowerCase();
  const seen = new Set<string>();
  const matched: string[] = [];
  for (const raw of keywords) {
    const k = raw.trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    if (keywordMatchesInHaystack(k, hay)) {
      seen.add(k.toLowerCase());
      matched.push(k);
    }
  }
  return matched;
}

export type MatchFieldHits = {
  title: string[];
  company: string[];
  description: string[];
};

export function getKeywordHitsByField(
  listing: ScorableListing,
  keywords: string[],
): MatchFieldHits {
  const fields = {
    title: listing.title.toLowerCase(),
    company: listing.company.toLowerCase(),
    description: listing.description.toLowerCase(),
  };
  const hits: MatchFieldHits = { title: [], company: [], description: [] };
  for (const raw of keywords) {
    const k = raw.trim();
    if (k.length < 2) continue;
    for (const [name, hay] of Object.entries(fields) as [
      keyof MatchFieldHits,
      string,
    ][]) {
      if (keywordMatchesInHaystack(k, hay) && !hits[name].includes(k)) {
        hits[name].push(k);
      }
    }
  }
  return hits;
}
