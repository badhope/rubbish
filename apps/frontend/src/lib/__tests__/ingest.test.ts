import { describe, expect, it } from "vitest";
import {
  CSV_IGNORE_TARGET,
  buildColumnMap,
  guessColumnMap,
  mergeDuplicateIngestResources,
  parseCsvHeader,
} from "@/lib/ingest";
import type { IngestResource } from "@/lib/types";

function resource(overrides: Partial<IngestResource> = {}): IngestResource {
  return {
    title: "A Paper",
    type: "paper",
    authors: ["Alice A"],
    discipline: "unknown",
    tags: [],
    abstract: "",
    ...overrides,
  };
}

describe("CSV header mapping", () => {
  it("reads a quoted header row and guesses Chinese aliases", () => {
    const headers = parseCsvHeader('"标题","作者","发表年份","期刊","备注"\n');
    expect(headers).toEqual(["标题", "作者", "发表年份", "期刊", "备注"]);
    expect(guessColumnMap(headers)).toEqual({
      标题: "title",
      作者: "authors",
      发表年份: CSV_IGNORE_TARGET,
      期刊: "venue",
      备注: CSV_IGNORE_TARGET,
    });
  });

  it("keeps explicit ignore so backend alias fallback cannot revive a column", () => {
    expect(
      buildColumnMap(["journal", "note"], { journal: CSV_IGNORE_TARGET }),
    ).toEqual({
      journal: CSV_IGNORE_TARGET,
      note: CSV_IGNORE_TARGET,
    });
  });
});

describe("mergeDuplicateIngestResources", () => {
  it("merges DOI duplicates and fills missing fields", () => {
    const first = resource({ doi: "10.1/X", abstract: "short", venue: null });
    const second = resource({
      title: "A Paper (duplicate)",
      doi: "10.1/x",
      authors: ["Bob B"],
      tags: ["ml"],
      abstract: "a much longer abstract",
      venue: "Journal",
    });

    const result = mergeDuplicateIngestResources([first, second]);

    expect(result.merged).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].authors).toEqual(["Alice A", "Bob B"]);
    expect(result.data[0].tags).toEqual(["ml"]);
    expect(result.data[0].venue).toBe("Journal");
    expect(result.data[0].abstract).toBe("a much longer abstract");
  });

  it("falls back to normalized title and keeps genuinely different papers", () => {
    const result = mergeDuplicateIngestResources([
      resource({ title: "Same   Title" }),
      resource({ title: "same title", authors: ["Bob B"] }),
      resource({ title: "Different", authors: ["Carol C"] }),
    ]);

    expect(result.merged).toBe(1);
    expect(result.data).toHaveLength(2);
    expect(result.data[1].title).toBe("Different");
  });
});
