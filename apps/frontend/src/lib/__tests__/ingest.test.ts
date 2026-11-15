import { describe, expect, it } from "vitest";
import {
  CSV_IGNORE_TARGET,
  buildColumnMap,
  guessColumnMap,
  ingestToSubmission,
  mergeDuplicateIngestResources,
  normalizeIngestAuthorName,
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

describe("ingestToSubmission", () => {
  it("reports every missing required field instead of inventing values", () => {
    const result = ingestToSubmission(resource());

    expect(result.payload).toBeNull();
    expect(result.errors).toContain("年份缺失或非法（-3000–2100）");
    expect(result.errors).toContain("学科为空（unknown 不算有效学科）");
    expect(result.errors).toContain("摘要为空，需单条补全后再投");
  });

  it("uses batch overrides only for missing year/discipline and maps journal to paper", () => {
    const result = ingestToSubmission(
      resource({
        type: "journal",
        authors: ["Kingma, Diederik P"],
        year: null,
        abstract: "A usable abstract.",
      }),
      { discipline: "计算机科学", year: 2020 },
    );

    expect(result.errors).toEqual([]);
    expect(result.payload).toMatchObject({
      title: "A Paper",
      type: "paper",
      authors: ["Diederik P Kingma"],
      year: 2020,
      discipline: "计算机科学",
      preview: "A usable abstract.",
    });
  });

  it("does not overwrite a record's own year or discipline", () => {
    const result = ingestToSubmission(
      resource({
        year: 2024,
        discipline: "physics",
        abstract: "Existing abstract.",
      }),
      { discipline: "计算机科学", year: 1999 },
    );

    expect(result.payload?.year).toBe(2024);
    expect(result.payload?.discipline).toBe("physics");
  });

  it("normalizes Last, First author names", () => {
    expect(normalizeIngestAuthorName("Kingma, Diederik P")).toBe(
      "Diederik P Kingma",
    );
    expect(normalizeIngestAuthorName("Alice A")).toBe("Alice A");
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

  it("only merges same-title records from the same first author", () => {
    const result = mergeDuplicateIngestResources([
      resource({ title: "Same   Title", authors: ["Alice A"] }),
      resource({ title: "same title", authors: ["Alice A"] }),
      resource({ title: "Same Title", authors: ["Bob B"] }),
      resource({ title: "Different", authors: ["Carol C"] }),
    ]);

    expect(result.merged).toBe(1);
    expect(result.data).toHaveLength(3);
    expect(result.data[1].authors).toEqual(["Bob B"]);
  });
});
