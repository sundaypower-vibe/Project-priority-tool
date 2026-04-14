import { Client, isFullPage } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

export const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

export type NotionProject = {
  id: string;
  plantName: string;
  projectStatus: string;
  projectModel: string;
  salesRep: string;
  pmSp: string;
  desDepKwp: string;
  estFid: string;
  estCod: string;
  probFid26: string;
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
      return (
        prop.people
          .map((p) => {
            if ("name" in p && p.name) return p.name;
            return "";
          })
          .filter(Boolean)
          .join(", ") || ""
      );

    case "date":
      return prop.date?.start ?? "";

    case "number":
      return prop.number !== null ? String(prop.number) : "";

    case "formula":
      if (prop.formula.type === "string") return prop.formula.string ?? "";
      if (prop.formula.type === "number")
        return prop.formula.number !== null ? String(prop.formula.number) : "";
      if (prop.formula.type === "date")
        return prop.formula.date?.start ?? "";
      return "";

    case "rollup":
      if (prop.rollup.type === "number")
        return prop.rollup.number !== null ? String(prop.rollup.number) : "";
      return "";

    case "checkbox":
      return prop.checkbox ? "Yes" : "No";

    case "status":
      return prop.status?.name ?? "";

    default:
      return "";
  }
}

// Find a property by partial name match (handles emoji prefixes)
function findProperty(
  page: PageObjectResponse,
  searchTerm: string
): string {
  const keys = Object.keys(page.properties);

  // Exact match first
  if (keys.includes(searchTerm)) {
    return extractPropertyValue(page, searchTerm);
  }

  // Partial match (ignoring emoji prefixes)
  const match = keys.find(
    (k) =>
      k.toLowerCase().includes(searchTerm.toLowerCase()) ||
      k
        .replace(/[\u{1F300}-\u{1FFFF}]/gu, "")
        .replace(/[\u2600-\u27BF]/g, "")
        .trim()
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
  );
  if (match) return extractPropertyValue(page, match);

  return "";
}

export async function getSolarProjects(): Promise<NotionProject[]> {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    throw new Error("NOTION_DATABASE_ID is not set");
  }

  const projects: NotionProject[] = [];
  let cursor: string | undefined = undefined;

  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of response.results) {
      if (!isFullPage(page)) continue;

      projects.push({
        id: page.id,
        plantName: findProperty(page, "Plant name"),
        projectStatus: findProperty(page, "Project status"),
        projectModel: findProperty(page, "Project model"),
        salesRep: findProperty(page, "Sales rep"),
        pmSp: findProperty(page, "PM SP"),
        desDepKwp: findProperty(page, "Des./Dep. kWp"),
        estFid: findProperty(page, "Est. FID"),
        estCod: findProperty(page, "Est. COD"),
        probFid26: findProperty(page, "Prob. FID '26"),
      });
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return projects;
}
