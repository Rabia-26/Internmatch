import { logger } from "./logger";
import { scrapeInternshipsFromBoards, type JobListing } from "./jobScraper";

export type { JobListing };

const JOB_SOURCES = [
  { id: "internshala", name: "Internshala" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "wellfound", name: "Wellfound" },
  { id: "naukri", name: "Naukri" },
];

const BOARD_LABEL: Record<string, string> = {
  internshala: "Internshala",
  linkedin: "LinkedIn",
  wellfound: "Wellfound",
  naukri: "Naukri",
};

function mockListings(
  keywords: string[],
  sourceName: string,
  url: string,
): JobListing[] {
  const tag = keywords[0] ?? "tech";
  return [
    {
      title: `${tag} Intern`,
      company: "Sample Co.",
      location: "Bangalore · Hybrid",
      url,
      description: `Demo listing for ${sourceName}.`,
      source: sourceName,
    },
  ];
}

/** Multi-board scrape + keyword ranking (no external agent calls). */
export async function searchInternshipsAcrossWeb(params: {
  keywords: string[];
  location?: string;
  onSourceStart?: (sourceId: string, index: number, total: number) => void;
}): Promise<JobListing[]> {
  const { keywords, location, onSourceStart } = params;

  const wrappedOnStart = (
    sourceId: string,
    index: number,
    total: number,
  ) => {
    const label = BOARD_LABEL[sourceId] ?? sourceId;
    logger.info(
      `[JOBS] Board ${index + 1}/${total}: ${label} (${sourceId})`,
    );
    onSourceStart?.(sourceId, index, total);
  };

  let listings = await scrapeInternshipsFromBoards({
    keywords,
    location,
    onSourceStart: wrappedOnStart,
  });

  if (listings.length === 0) {
    logger.warn("[JOBS] No listings from scrape — using demo placeholders");
    listings = JOB_SOURCES.flatMap((s) =>
      mockListings(keywords, s.name, `https://${s.id}.com`),
    );
  }

  return listings;
}

export { JOB_SOURCES };
