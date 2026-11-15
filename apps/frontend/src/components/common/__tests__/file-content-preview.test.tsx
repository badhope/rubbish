import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import FileContentPreview from "@/components/common/file-content-preview";

function file(content: string, name: string, type: string): File {
  return new File([content], name, { type });
}

describe("FileContentPreview", () => {
  it("renders CSV as a table instead of a raw blob", async () => {
    render(
      <FileContentPreview
        blob={file("title,authors\nPaper,Alice\n", "refs.csv", "text/csv")}
        filename="refs.csv"
        contentType="text/csv"
      />,
    );

    expect(
      await screen.findByRole("columnheader", { name: "title" }),
    ).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "authors" })).toBeTruthy();
    expect(screen.getByText("Paper")).toBeTruthy();
  });

  it("renders code/text with a bounded pre block", async () => {
    render(
      <FileContentPreview
        blob={file('console.log("hi")\n', "main.ts", "text/plain")}
        filename="main.ts"
        contentType="text/plain"
      />,
    );

    expect(await screen.findByText('console.log("hi")')).toBeTruthy();
  });

  it("gives an explicit download fallback for Word/Excel/ZIP", () => {
    render(
      <FileContentPreview
        blob={file("", "review.docx", "")}
        filename="review.docx"
      />,
    );

    expect(screen.getByText(/浏览器不能可靠内联预览/)).toBeTruthy();
  });
});
