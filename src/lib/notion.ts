import { Client, isFullPage } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

export const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

export type NotionProject = {
  id: string;
  plantName: string;
  poGroup: string;
  projectStatus: string;
  projectModel: string;
  salesRep: string;
  pmSp: string;
  desDepKwp: string;
  estFid: string;
  estCod: string;
  probFid26: string;
  netMarginReporting: string;
  netMarginWp: string;
};

function extractPropertyValue(
  page: PageObjectResponse,
  propertyName: string
): string {
  const prop = page.properties[propertyName];
  if (!prop) return "";

  switch (prop.type) {
    case "title":
      return prop.title.map((t) => t.plain_text).join("") || "";
    case "rich_text":
      return prop.rich_text.map((t) => t.plain_text).join("") || "";
    case "select":
      return prop.select?.name ?? "";
    case "multi_select":
      return prop.multi_select.map((s) => s.name).join(", ") || "";
    case "people":
      return prop.people.map((p) => ("name" in p && p.name ? p.name : "")).filter(Boolean).join(", ") || "";
    case "date":
      return prop.date?.start ?? "";
    case "number":
      return prop.number !== null ? String(prop.number) : "";
    case "formula":
      if (prop.formula.type === "string") return prop.formula.string ?? "";
      if (prop.formula.type === "number") return prop.formula.number !== null ? String(prop.formula.number) : "";
      if (prop.formula.type === "date") return prop.formula.date?.start ?? "";
      return "";
    case "rollup":
      if (prop.rollup.type === "number") return prop.rollup.number !== null ? String(prop.rollup.number) : "";
      return "";
    case "checkbox":
      return prop.checkbox ? "Yes" : "No";
    case "status":
      return prop.status?.name ?? "";
    case "relation":
      // Return IDs joined — resolved to names later
      return prop.relation.map((r) => r.id).join(",");
    default:
      return "";
  }
}

function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, "")
    .replace(/[\u2600-\u27BF]/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .trim();
}

function findProperty(page: PageObjectResponse, searchTerm: string): string {
  const keys = Object.keys(page.properties);
  const lc = searchTerm.toLowerCase();

  if (keys.includes(searchTerm)) return extractPropertyValue(page, searchTerm);

  const exactStripped = keys.find((k) => stripEmoji(k).toLowerCase() === lc);
  if (exactStripped) return extractPropertyValue(page, exactStripped);

  const partial = keys.find(
    (k) => k.toLowerCase().includes(lc) || stripEmoji(k).toLowerCase().includes(lc)
  );
  if (partial) return extractPropertyValue(page, partial);

  if (lc === "plant name" || lc === "name") {
    const titleKey = keys.find((k) => page.properties[k].type === "title");
    if (titleKey) return extractPropertyValue(page, titleKey);
  }

  return "";
}

// Retry wrapper for rate-limited Notion calls
async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  let delay = 500;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        typeof err === "object" && err !== null &&
        (("status" in err && (err as { status: number }).status === 429) ||
         ("code" in err && (err as { code: string }).code === "rate_limited"));
      if (!isRateLimit || i === retries - 1) throw err;
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
    }
  }
  throw new Error("Unreachable");
}

// Fetch the title of a related page by ID
async function resolvePageTitle(pageId: string): Promise<string> {
  try {
    const page = await withRetry(() => notion.pages.retrieve({ page_id: pageId }));
    if (!isFullPage(page)) return "";
    for (const prop of Object.values(page.properties)) {
      if (prop.type === "title") {
        return prop.title.map((t) => t.plain_text).join("").trim();
      }
    }
  } catch {
    // ignore errors for individual page lookups
  }
  return "";
}

export async function getSolarProjects(): Promise<NotionProject[]> {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) throw new Error("NOTION_DATABASE_ID is not set");

  // Step 1 — fetch all project pages
  const rawProjects: Array<{ page: PageObjectResponse; poGroupIds: string[] }> = [];
  let cursor: string | undefined = undefined;

  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of response.results) {
      if (!isFullPage(page)) continue;

      const projectStatus = findProperty(page, "Project status");
      const statusLc = projectStatus.toLowerCase();
      if (
        statusLc.includes("in operation") ||
        statusLc.includes("cancelled") ||
        statusLc.includes("sold")
      ) continue;

      // Collect relation IDs for PO Group
      const poGroupRaw = findProperty(page, "PO Group");
      const poGroupIds = poGroupRaw ? poGroupRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

      rawProjects.push({ page, poGroupIds });
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  // Step 2 — resolve unique relation page IDs → titles (batched to avoid rate limits)
  const allIds = [...new Set(rawProjects.flatMap((r) => r.poGroupIds))];
  const titleMap = new Map<string, string>();
  const BATCH = 5;

  for (let i = 0; i < allIds.length; i += BATCH) {
    const batch = allIds.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (id) => {
        const title = await resolvePageTitle(id);
        titleMap.set(id, title);
      })
    );
    if (i + BATCH < allIds.length) await new Promise((res) => setTimeout(res, 200));
  }

  // Step 3 — build final projects
  return rawProjects.map(({ page, poGroupIds }) => {
    const projectStatus = findProperty(page, "Project status");
    const poGroup = poGroupIds.map((id) => titleMap.get(id) ?? "").filter(Boolean).join(", ");

    return {
      id: page.id,
      plantName: findProperty(page, "Plant name"),
      poGroup,
      projectStatus,
      projectModel: findProperty(page, "Project model"),
      salesRep: findProperty(page, "Sales rep"),
      pmSp: findProperty(page, "PM SP"),
      desDepKwp: findProperty(page, "Des./Dep. kWp"),
      estFid: findProperty(page, "Est. FID"),
      estCod: findProperty(page, "Est. COD"),
      probFid26: findProperty(page, "Prob. FID '26"),
      netMarginReporting: findProperty(page, "Net margin reporting"),
      netMarginWp: findProperty(page, "Net margin / Wp"),
    };
  });
}
