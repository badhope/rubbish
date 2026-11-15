import type {
  IngestResource,
  SubmissionCreate,
  SubmissionType,
} from "@/lib/types";
import { parseDelimitedPreview } from "@/lib/file-preview";

/** CSV 列可映射到的 IngestResource 字段。 */
export const CSV_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: "__ignore__", label: "忽略此列" },
  { value: "title", label: "标题" },
  { value: "authors", label: "作者" },
  { value: "year", label: "年份" },
  { value: "type", label: "类型" },
  { value: "venue", label: "期刊 / 来源" },
  { value: "discipline", label: "学科" },
  { value: "subdiscipline", label: "子学科" },
  { value: "tags", label: "关键词 / 标签" },
  { value: "abstract", label: "摘要" },
  { value: "doi", label: "DOI" },
  { value: "publisher", label: "出版方" },
  { value: "volume", label: "卷" },
  { value: "issue", label: "期" },
  { value: "pages", label: "页码" },
  { value: "issn", label: "ISSN" },
  { value: "short_container_title", label: "期刊简称" },
];

export const CSV_IGNORE_TARGET = "__ignore__";

const HEADER_ALIASES: Record<string, string> = {
  title: "title",
  标题: "title",
  题名: "title",
  name: "title",
  authors: "authors",
  author: "authors",
  作者: "authors",
  作者列表: "authors",
  year: "year",
  年份: "year",
  年: "year",
  type: "type",
  类型: "type",
  venue: "venue",
  journal: "venue",
  期刊: "venue",
  来源: "venue",
  刊物: "venue",
  discipline: "discipline",
  学科: "discipline",
  领域: "discipline",
  subdiscipline: "subdiscipline",
  子学科: "subdiscipline",
  tags: "tags",
  keywords: "tags",
  关键词: "tags",
  标签: "tags",
  abstract: "abstract",
  摘要: "abstract",
  doi: "doi",
  publisher: "publisher",
  出版方: "publisher",
  出版社: "publisher",
  volume: "volume",
  卷: "volume",
  issue: "issue",
  期: "issue",
  pages: "pages",
  页码: "pages",
  issn: "issn",
  short_container_title: "short_container_title",
  journal_abbrev: "short_container_title",
  简称: "short_container_title",
};

function normalizeHeader(header: string): string {
  return header
    .trim()
    .replace(/^\ufeff/, "")
    .toLowerCase()
    .replace(/[- ]/g, "_");
}

/** 读取 CSV 第一个非空行作为表头，避免把整份文件解析进内存。 */
export function parseCsvHeader(content: string): string[] {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim() !== "");
  if (!firstLine) return [];
  const parsed = parseDelimitedPreview(
    firstLine,
    firstLine.includes("\t") ? "\t" : ",",
    1,
    100,
  );
  return (
    parsed.rows[0]?.map((cell) => cell.trim().replace(/^\ufeff/, "")) ?? []
  );
}

/** 依据常见中英文表头自动给出映射，未识别的列显式忽略。 */
export function guessColumnMap(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const result: Record<string, string> = {};
  for (const header of headers) {
    const target = HEADER_ALIASES[normalizeHeader(header)];
    if (target && !used.has(target)) {
      result[header] = target;
      used.add(target);
    } else {
      result[header] = CSV_IGNORE_TARGET;
    }
  }
  return result;
}

/** 把显式映射转成后端需要的形态；未给值的列按忽略处理。 */
export function buildColumnMap(
  headers: string[],
  mapping: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers.length) return undefined;
  return Object.fromEntries(
    headers.map((header) => [header, mapping[header] || CSV_IGNORE_TARGET]),
  );
}

function normalizedTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function duplicateKey(resource: IngestResource): string {
  const doi = resource.doi?.trim().toLowerCase();
  if (doi) return `doi:${doi}`;
  // 没 DOI 时不能只按标题合并：不同作者的同名“Editorial”会被误吞。
  const firstAuthor = (resource.authors[0] ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return `title:${normalizedTitle(resource.title)}|author:${firstAuthor}`;
}

function mergeMissingFields(
  base: IngestResource,
  extra: IngestResource,
): IngestResource {
  const merged: IngestResource = {
    ...base,
    authors: Array.from(
      new Set(
        [...base.authors, ...extra.authors]
          .map((a) => a.trim())
          .filter(Boolean),
      ),
    ),
    tags: Array.from(
      new Set(
        [...base.tags, ...extra.tags].map((t) => t.trim()).filter(Boolean),
      ),
    ),
  };
  const fill: (keyof IngestResource)[] = [
    "year",
    "venue",
    "discipline",
    "subdiscipline",
    "doi",
    "publisher",
    "volume",
    "issue",
    "pages",
    "issn",
    "short_container_title",
  ];
  for (const key of fill) {
    const currentValue = merged[key];
    const isEmpty =
      currentValue == null ||
      currentValue === "" ||
      (key === "discipline" && currentValue === "unknown");
    if (isEmpty) {
      // 每个字段类型不同，但都来自同一 IngestResource，后端已校验过。
      Object.assign(merged, { [key]: extra[key] });
    }
  }
  if (
    !merged.abstract?.trim() ||
    (extra.abstract?.trim().length ?? 0) > merged.abstract.trim().length
  ) {
    merged.abstract = extra.abstract;
  }
  return merged;
}

/** 合并 DOI（优先）或规范化标题相同的重复记录；保留字段更完整的一条。 */
export function mergeDuplicateIngestResources(resources: IngestResource[]): {
  data: IngestResource[];
  merged: number;
} {
  const byKey = new Map<string, IngestResource>();
  let merged = 0;
  for (const resource of resources) {
    const key = duplicateKey(resource);
    const current = byKey.get(key);
    if (current) {
      byKey.set(key, mergeMissingFields(current, resource));
      merged += 1;
    } else {
      byKey.set(key, resource);
    }
  }
  return { data: Array.from(byKey.values()), merged };
}

const SUBMISSION_TYPE_MAP: Record<IngestResource["type"], SubmissionType> = {
  paper: "paper",
  book: "book",
  dataset: "dataset",
  tutorial: "tutorial",
  // 期刊、预印本、学位论文没有对应的投稿类型；按论文投稿，
  // 保留原始 venue/DOI，编辑可在评审阶段再调整。
  journal: "paper",
  preprint: "paper",
  thesis: "paper",
};

/** 把 BibTeX/Crossref 常见的 "Last, First" 规范成 "First Last"。 */
export function normalizeIngestAuthorName(value: string): string {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 ? `${parts.slice(1).join(" ")} ${parts[0]}` : value.trim();
}

export interface IngestSubmissionOptions {
  /** 只补缺失/unknown 的学科，不覆盖已有值。 */
  discipline?: string;
  /** 只补缺失年份，不覆盖已有值。 */
  year?: number | null;
}

export interface IngestSubmissionPreflight {
  payload: SubmissionCreate | null;
  errors: string[];
}

/**
 * 导入记录转投稿前后的预检：投稿接口要求标题、作者、年份、学科、摘要齐全。
 * 这里不替用户编造缺失字段，也不静默截断超长内容；缺什么就明确列出来。
 */
export function ingestToSubmission(
  resource: IngestResource,
  options: IngestSubmissionOptions = {},
): IngestSubmissionPreflight {
  const errors: string[] = [];
  const title = resource.title.trim();
  if (!title) errors.push("标题为空");
  else if (title.length > 1000) errors.push("标题超过 1000 字");

  const authors = resource.authors
    .map(normalizeIngestAuthorName)
    .filter(Boolean);
  if (authors.length === 0) errors.push("作者为空");
  else if (authors.length > 200) errors.push("作者超过 200 位");

  const year = resource.year ?? options.year ?? null;
  if (
    year === null ||
    !Number.isInteger(year) ||
    year < -3000 ||
    year > 2100
  ) {
    errors.push("年份缺失或非法（-3000–2100）");
  }

  const rawDiscipline = resource.discipline?.trim() ?? "";
  const discipline =
    rawDiscipline && rawDiscipline !== "unknown"
      ? rawDiscipline
      : (options.discipline?.trim() ?? "");
  if (!discipline) errors.push("学科为空（unknown 不算有效学科）");
  else if (discipline.length > 100) errors.push("学科超过 100 字");

  const abstract = resource.abstract?.trim() ?? "";
  if (!abstract) errors.push("摘要为空，需单条补全后再投");
  else if (abstract.length > 20000) errors.push("摘要超过 20000 字");

  if (errors.length > 0) return { payload: null, errors };

  return {
    payload: {
      title,
      type: SUBMISSION_TYPE_MAP[resource.type],
      authors,
      year: year as number,
      venue: resource.venue,
      discipline,
      subdiscipline: resource.subdiscipline,
      tags: resource.tags,
      abstract,
      preview: abstract.slice(0, 500),
      doi: resource.doi,
    },
    errors: [],
  };
}
