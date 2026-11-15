import { describe, expect, it } from "vitest";
import { detectFileViewer, parseDelimitedPreview } from "@/lib/file-preview";

describe("detectFileViewer", () => {
  it("routes images, PDF, CSV and text by extension or MIME", () => {
    expect(detectFileViewer("scan.PNG")).toBe("image");
    expect(detectFileViewer("paper.pdf")).toBe("pdf");
    expect(detectFileViewer("data.csv")).toBe("csv");
    expect(detectFileViewer("notes.md")).toBe("text");
    expect(detectFileViewer("blob", "application/pdf")).toBe("pdf");
    expect(detectFileViewer("blob", "text/csv")).toBe("csv");
  });

  it("keeps Word/Excel/ZIP as explicit download fallbacks", () => {
    expect(detectFileViewer("review.docx")).toBe("unsupported");
    expect(detectFileViewer("sheet.xlsx")).toBe("unsupported");
    expect(detectFileViewer("bundle.zip")).toBe("unsupported");
  });
});

describe("parseDelimitedPreview", () => {
  it("keeps quoted commas, escaped quotes and newlines inside cells", () => {
    const parsed = parseDelimitedPreview(
      'title,note\n"A, B","line1\nline2"\n"say ""hi"", ok",x\n',
    );
    expect(parsed.rows[1]).toEqual(["A, B", "line1\nline2"]);
    expect(parsed.rows[2]).toEqual(['say "hi", ok', "x"]);
    expect(parsed.totalRows).toBe(3);
  });

  it("caps preview rows and columns without pretending the file is short", () => {
    const rows = ["a,b,c"];
    for (let i = 0; i < 120; i += 1) rows.push(`${i},${i},${i}`);
    const parsed = parseDelimitedPreview(rows.join("\n"), ",", 5, 2);
    expect(parsed.rows.length).toBe(5);
    expect(parsed.rows[0]).toEqual(["a", "b"]);
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalRows).toBe(121);
  });
});
