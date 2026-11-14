/**
 * 在线稿件的纯文本预处理：题录/摘要/参考文献拆分、轨道裁剪、重复段清理、
 * 邮箱脱敏。这里不依赖 React，便于单测和复用；渲染由 manuscript-render.tsx
 * 负责，本模块只回答“正文应该长什么样”。
 */

function headingMatches(title: string, patterns: RegExp[]): boolean {
  const t = title.trim().replace(/[：:：\s]+$/, "");
  return patterns.some((re) => re.test(t));
}

const ABSTRACT_RE = /^(摘[ \t\u3000]*要|Abstract|ABSTRACT)$/i;
const KEYWORDS_RE = /^(关键词|关键字|Keywords?)$/i;
const CLC_RE = /^(中图分类号|CLC)$/i;
const REFS_RE = /^(参考文献|References?|Bibliography)$/i;
const DECLS_RE =
  /^(作者贡献|作者声明|作者信息|作者简介|贡献声明|声明|利益冲突|基金项目?|资助|数据可用性|伦理声明|AI[ \t\u3000]*使用声明?|致谢|Acknowledg(e)?ments?)$/i;
const DOI_RE = /^(DOI|doi)$/i;
const SCORE_RE = /^(评分|质量等级|RQS)$/i;

// 所有需要剥掉的学术小节标题（用于行内标题规范化）
const ALL_BLOCK_TITLES =
  "摘[ \\t\\u3000]*要|Abstract|ABSTRACT|关键词|关键字|Keywords?|中图分类号|CLC|参考文献|References?|Bibliography|作者贡献|作者声明|贡献声明|利益冲突|基金项目?|资助|数据可用性|伦理声明|AI[ \\t\\u3000]*使用声明?|致谢|Acknowledg(e)?ments?|DOI|doi|评分|质量等级|RQS";

/**
 * 规范化：逐行处理。只对"本行内出现 #+ 块标题但不在行首"的行，
 * 把该片段拆成独立行；其余行一个字都不改。
 * 关键：用负向后顾 (?<!#) 避免把 `## 关键词` 的第一个 # 当成"行内文本"吃掉。
 */
function normalizeInlineHeadings(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  // 行内块标题：# 后跟块标题词，且前面不是 #（避免拆 ## ）
  const inlineRe = new RegExp(
    `(?<![#\\n])#{1,6}[ \\t]+(?:${ALL_BLOCK_TITLES})[ \\t]*[:：]?`,
    "g",
  );
  for (const line of lines) {
    // 已经是行首标题的行不动
    if (/^#{1,6}\s+/.test(line)) {
      out.push(line);
      continue;
    }
    // 行内出现块标题 → 用 matchAll 定位并拆行
    const matches = [...line.matchAll(inlineRe)];
    if (matches.length === 0) {
      out.push(line);
      continue;
    }
    let cursor = 0;
    for (const m of matches) {
      const start = m.index ?? 0;
      const before = line.slice(cursor, start);
      if (before.trim()) out.push(before);
      out.push("");
      out.push(m[0]);
      out.push("");
      cursor = start + m[0].length;
    }
    const after = line.slice(cursor);
    if (after.trim()) out.push(after);
  }
  return out.join("\n");
}

/**
 * 剥掉文首学术刊头块：从开头到第一个正文小节之前，整块丢弃。
 * 待剥范围：H1 标题（与页头标题重复）、期刊 Logo 图、Open Access/Received/Accepted 行、
 * 作者单位/邮箱/通讯作者标记。只对 fun/rant 生效。
 * 判据：剥完后 article 内不再出现第二个 H1 标题、Logo、刊头英文。
 */
function dropAcademicHeader(md: string): string {
  const lines = md.split("\n");
  // 找第一个正文 H2/H3（1 引言 / 2.1 方法 / Introduction 等）
  let firstBodyIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{2,3})\s+(.*)$/.exec(lines[i]);
    if (m) {
      const title = m[2].trim();
      if (
        /^(\d+(\.\d+)*\s*|引言|Introduction|方法|Method|结果|Result|讨论|Discussion|结论|Conclusion)/.test(
          title,
        ) &&
        !headingMatches(title, [
          ABSTRACT_RE,
          KEYWORDS_RE,
          CLC_RE,
          REFS_RE,
          DECLS_RE,
          DOI_RE,
        ])
      ) {
        firstBodyIdx = i;
        break;
      }
    }
  }
  if (firstBodyIdx <= 0) return md;
  const headerBlock = lines.slice(0, firstBodyIdx).join("\n");
  // 刊头特征：Open Access / Received / Accepted / Logo 图 / 学院/大学/邮箱 / H1
  if (
    /(Open Access|Received|Accepted|Copyright|©|!\[.*\]\(|@|School|University|Department|学院|大学|单位|通讯作者|Corresponding|Rubbish\s+Journal|ISSN|作者[:：])/i.test(
      headerBlock,
    )
  ) {
    return lines.slice(firstBodyIdx).join("\n");
  }
  return md;
}

/**
 * 按轨道裁剪 Markdown：删除指定的 ## / ### 小节。
 * fun/rant：删 摘要/关键词/CLC/参考文献/声明/DOI；保留正文与「参考资料」
 * sci_pop：删 摘要/关键词/CLC/评分/DOI；保留正文与「延伸阅读」
 * 安全护栏：删完后若剩余 < 原文 60% 或找不到正文标题，回退为不裁剪。
 */
// 论文轨：页面已经展示标题/作者/摘要，正文若从原稿复制了同一段题录与摘要，
// 会形成“标题重复 + 作者裸行 + 摘要重复”的三连。这里只删重复部分：
// 文首标题块、作者信息起至正文前的摘要块；文首的声明/伦理说明保留。
export function stripPaperFrontMatter(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const isBodyStart = (line: string) => {
    const t = line.trim();
    if (!/^#{1,3}\s+/.test(t)) return false;
    if (/^#{2,3}\s+\d+\.\d+/.test(t)) return false;
    return (
      /^#{1,3}\s+(?:1(?:[.、]\s*|\s+)|[一二三四五六七八九十]+[、.]\s*)?(引言|绪论|Introduction)\b/i.test(
        t,
      ) || /^#{1,2}\s+1(?:\s|[.、])/.test(t)
    );
  };
  const bodyAt = lines.findIndex(isBodyStart);
  if (bodyAt <= 0 || bodyAt > 120) return md.trim();

  let front = lines.slice(0, bodyAt);
  // 摘要/作者块从出现处一直删到正文；保留它之前的声明与说明。
  const cutAt = front.findIndex(
    (line) =>
      /^\s*(?:\*\*)?(作者|Author)\s*[:：]/i.test(line) ||
      /^\s*(?:\*\*)?(中文摘要|摘\s*要|Abstract)\b/i.test(line),
  );
  if (cutAt >= 0) front = front.slice(0, cutAt);
  // 有些存量稿不写「作者：」而直接写「某某（独立研究者） 通讯作者：」，
  // 页头已经展示作者，这一行在正文里只会留下一个空标签。
  front = front.filter(
    (line) =>
      !/(独立研究者|通讯作者|Corresponding\s+author|E-?mail|邮箱\s*[:：]|@)/i.test(
        line,
      ),
  );
  while (front.length && !front[0].trim()) front.shift();

  // 文首标题块：只处理加粗标题块。`#` 标题可能是正文的 0.1 小节，
  // 若一律当重复标题删除，网页会丢掉 Word/PDF 里存在的第一个小节
  // （299/295 实锤：正文从 0.1 开始，网页却直接从「本 PADA 体系…」开始）。
  // 与页头同名的 `#` 标题已由 stripLeadingDuplicateTitle 精确删除。
  const first = front[0]?.trim() ?? "";
  if (first && first.startsWith("**")) {
    let end = 0;
    while (end < front.length && front[end].trim() !== "") end++;
    front = front.slice(end);
  }

  return [...front, "", ...lines.slice(bodyAt)].join("\n").trim();
}

function stripLeadingDuplicateTitle(md: string, title?: string | null): string {
  if (!title) return md;
  const norm = (x: string) =>
    x
      .replace(/^#{1,6}\s+/, "")
      .replace(/[*_`]/g, "")
      .replace(/[：:，,。.、\s]/g, "")
      .toLowerCase();
  const target = norm(title);
  if (target.length < 8) return md;
  const lines = md.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const m = /^(#{1,3})\s+(.+)$/.exec(lines[i]?.trim() ?? "");
  if (!m) return md;
  const h = norm(m[2]);
  if (!(
    h === target ||
    (h.length >= 8 && (target.startsWith(h) || h.startsWith(target)))
  ))
    return md;
  lines.splice(i, 1);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripLeadingDuplicateAbstract(
  md: string,
  abstract?: string | null,
): string {
  if (!abstract) return md;
  const norm = (s: string) =>
    s
      .replace(/[“”"']/g, "")
      .replace(/[ \t\u3000]+/g, "")
      .replace(/\n+/g, "")
      .trim();
  const target = norm(abstract);
  if (target.length < 40) return md;
  const lines = md.split("\n");
  const heading = lines.findIndex((line) => /^##\s+/.test(line));
  if (heading < 0) return md;
  let start = heading + 1;
  while (start < lines.length && !lines[start].trim()) start++;
  let end = start;
  while (
    end < lines.length &&
    lines[end].trim() &&
    !/^#{1,6}\s/.test(lines[end])
  )
    end++;
  const paragraph = norm(lines.slice(start, end).join("\n"));
  if (paragraph.length < 40) return md;
  // api.abstract 有时会把「1 引言」和正文一起塞进来，
  // 因此用「正文首段是否出现在摘要全文里」判断，而不是只比开头。
  if (!target.includes(paragraph.slice(0, Math.min(80, paragraph.length))))
    return md;
  lines.splice(start, end - start);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 副刊原稿常见「摘要/导读」和「引言」各写一遍同一段：保留第一次出现，
// 删掉后面的完整重复段。只处理长度 >= 40 的独立段落，避免删掉短句、
// 图注或作者刻意做的复沓。
export function dedupeRepeatedParagraphs(md: string): string {
  const norm = (s: string) =>
    s
      .replace(/[“”"']/g, "")
      .replace(/[ \t\u3000]+/g, "")
      .replace(/\n+/g, "")
      .toLowerCase();
  const seen = new Set<string>();
  const earlier: string[] = [];
  const blocks = md.split(/\n{2,}/);
  const kept = blocks.filter((block) => {
    const n = norm(block);
    if (n.length < 40) return true;
    if (seen.has(n)) return false;
    // 摘要版通常是完整长段，引言版是它的缩短复述：后者开头相同、
    // 长度更短，按前缀认作重复段删掉，避免只做全等匹配漏掉。
    const probe = n.slice(0, Math.min(80, n.length));
    if (
      earlier.some((prev) => prev.length > n.length && prev.startsWith(probe))
    ) {
      return false;
    }
    seen.add(n);
    earlier.push(n);
    return true;
  });
  return kept.join("\n\n");
}

// 同一段里逐句复述也很常见（摘要写一遍、引言再写一遍），按句子去重；
// 只处理 >= 20 字的完整句，短句、标题和列表标记原样保留。
export function dedupeRepeatedSentences(md: string): string {
  const norm = (s: string) =>
    s
      .replace(/[“”"']/g, "")
      .replace(/[ \t\u3000]+/g, "")
      .replace(/\n+/g, "")
      .toLowerCase();
  const seen = new Set<string>();
  return md
    .split("\n")
    .map((line) => {
      if (/^#{1,6}\s/.test(line.trim())) return line;
      const parts = line.split(/(?<=[。！？!?])/);
      return parts
        .filter((sentence) => {
          const n = norm(sentence);
          if (n.length < 20) return true;
          if (seen.has(n)) return false;
          seen.add(n);
          return true;
        })
        .join("");
    })
    .join("\n");
}

function stripFunFrontMatter(md: string): string {
  const cutBlock = (lines: string[], re: RegExp) => {
    const start = lines.findIndex((line) => re.test(line.trim()));
    if (start < 0) return lines;
    let end = start + 1;
    while (end < lines.length && !/^#{2,6}\s/.test(lines[end])) end++;
    return [...lines.slice(0, start), ...lines.slice(end)];
  };
  let lines = md.split("\n");
  lines = cutBlock(lines, /^##[ \t]*(?:摘[ \t\u3000]*要|Abstract)$/i);
  lines = cutBlock(lines, /^##[ \t]*(?:关键词|关键字|Keywords?)$/i);
  const out = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // 极端稿子可能只有摘要没有正文；宁可保留原稿，也不要把页面清空。
  return out.length >= 500 ? out : md;
}

export function stripAcademicSections(
  md: string,
  kind: string,
  title?: string | null,
): string {
  md = stripLeadingDuplicateTitle(md, title);
  if (kind === "paper") return stripPaperFrontMatter(md);
  if (kind === "plain") return md;

  // 先统一换行：去掉 \r（Windows 换行残留会导致 $ 锚点不匹配）
  md = md.replace(/\r/g, "");
  // 娱乐页的页头已经展示标题和作者；正文第一行常是原稿自带的
  // H1 标题与 ``**作者：** 某某``，不剥掉就会在页头下重复一遍。
  md = md.replace(/^\s*#\s+.*(?:\n+|$)/u, "");
  md = md.replace(/^\s*\*\*作者[:：]\*\*.*\n+/u, "");
  md = md.replace(/^\s*作者[:：].*\n+/u, "");
  // 副刊页头已经展示作者与单位；正文开头若还带 `姓名¹ / ¹ 单位`
  // 这类上标作者块，整块去掉，避免同一个人在同一屏出现两次。
  if (kind === "fun" || kind === "rant") {
    md = md.replace(
      /^\s*[^\n]{1,40}[¹²³⁴⁵⁶⁷⁸⁹]\s*\n+\s*[¹²³⁴⁵⁶⁷⁸⁹][^\n]*\n+/u,
      "",
    );
  }

  // 1) 先把行内标题规范化成行首（逐行处理，不动行首标题）
  let work = normalizeInlineHeadings(md);

  // 2) fun/rant 额外剥掉文首学术刊头（找不到正文标题时放弃，保持原文）
  if (kind === "fun" || kind === "rant") {
    work = stripFunFrontMatter(work);
    work = dropAcademicHeader(work);
  }

  const dropPatterns: RegExp[] = [ABSTRACT_RE, KEYWORDS_RE, CLC_RE, DOI_RE];
  if (kind === "fun" || kind === "rant") dropPatterns.push(REFS_RE, DECLS_RE);
  else if (kind === "sci_pop") dropPatterns.push(SCORE_RE);

  const lines = work.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const level = m[1].length;
      if (level > 1 && headingMatches(m[2], dropPatterns)) {
        i++;
        while (i < lines.length) {
          const next = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
          if (next) {
            const nextLevel = next[1].length;
            const nextTitle = next[2].trim();
            // 同级或更高级标题一定结束本节；标题层级不规范的稿子里，
            // 「## 摘要」后面直接跟「### 引言」，也必须在这里收住，
            // 否则会把整篇正文当成摘要一起删掉。
            if (nextLevel <= level) break;
            if (
              /^(\d+(\.\d+)*\s*|引言|Introduction|方法|Method|结果|Result|讨论|Discussion|结论|Conclusion)/.test(
                nextTitle,
              )
            )
              break;
          }
          i++;
        }
        continue;
      }
    }
    out.push(line);
    i++;
  }
  let result = out.join("\n");

  // 安全护栏：宁可多显示也不能删正文。
  // 娱乐稿的小节层级经常是「## 摘要 / ### 引言」这种不规范结构，
  // 删完摘要和参考文献后正文可能只剩 40%~50%，不能再用论文轨的 60% 阈值，
  // 否则会把整篇带摘要、参考文献的原始稿重新显示出来。
  // 只用「剩余内容是否还有实际正文」兜底：少于 500 字认为裁剪异常。
  const isFun = kind === "fun" || kind === "rant";
  if (isFun) {
    // 娱乐稿不挂参考文献，正文里的 [1]/[2,3] 只会变成无主的悬空编号。
    // 这是渲染层的全局兜底；源文件仍保留编号，便于回溯原稿。
    result = result
      .replace(/[ \t]*\[\d+(?:\s*[-,，]\s*\d+)*\][ \t]*/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ \n/g, "\n")
      .replace(/[ \t]+([，。、；：！？）])/g, "$1")
      // 有些娱乐稿拿高考/考试题当引子，正文里会整段复制“阅读下面的
      // 材料……写一篇文章”。题面属于引用，不是作者正文；保留会让读者
      // 以为点进了题库。只删明确带“以上材料…写一篇文章”的题面段。
      .replace(
        /（\d{4}\s*年[^）]{0,60}）\s*[\s\S]{0,1200}?以上材料[^\n]{0,240}\n+/g,
        "",
      );
    if (result.trim().length < 500) {
      console.warn(
        "[stripAcademicSections] fun result too short, falling back",
        {
          original: md.length,
          result: result.length,
        },
      );
      return md;
    }
    return result;
  }

  // 论文 / 科普轨保留原有双护栏
  if (result.length < md.length * 0.6) {
    console.warn(
      "[stripAcademicSections] result too short, falling back to original",
      {
        original: md.length,
        result: result.length,
      },
    );
    return md;
  }
  if (
    !/^#{1,3}\s+(\d+|引言|方法|结果|讨论|结论|Introduction|Method|Result|Discussion)/m.test(
      result,
    )
  ) {
    console.warn("[stripAcademicSections] no body heading found, falling back");
    return md;
  }
  return result;
}

// 娱乐轨去学术范式：娱乐文不套论文小节。把「引言/方法/结果/讨论/结论」
// 这类学术标题改写为网文口吻的小标题，并去掉章节编号；只动标题，不动正文。
// 触发条件严格限定 fun/rant，论文轨一个字都不改。
const FUN_HEADING_MAP: Array<[RegExp, string]> = [
  [/^(引言|绪论|前言|导论)(?:[：:（(].*)?$/i, "开场"],
  [/^(文献综述|相关工作|Related Work)$/i, "前情提要"],
  [
    /^(研究设计与方法|研究方法|方法|材料与方法|Methods?|Methodology|Materials and Methods)$/i,
    "怎么玩的",
  ],
  [/^(研究设计|实验设计)$/i, "怎么搭的"],
  [/^(实验设置|Experimental Setup)$/i, "怎么搭的"],
  [/^(核心概念界定与理论基础)$/i, "先把词说清"],
  [/^(核心概念界定)$/i, "语言通胀是个啥"],
  [/^(理论基础|分析框架)$/i, "拿什么看"],
  [/^(生成动因分析|动因分析)$/i, "为啥会这样"],
  [/^(语义贬值路径实证分析|实证分析)$/i, "拿数据说话"],
  [/^(典型场景的质性拆解|质性拆解)$/i, "一个个看"],
  [/^(数据可用性声明)$/i, "数据放哪了"],
  [/^(作者贡献声明)$/i, "谁干的"],
  [/^(利益冲突声明)$/i, "有没有猫腻"],
  [/^(数据分析|Data Analysis)$/i, "数据怎么说"],
  [/^(结果与讨论|结果|Results?)$/i, "所以呢"],
  [/^(讨论|Discussion)$/i, "聊两句"],
  [/^(结论|结语|总结)(?:[：:（(].*)?$/i, "最后"],
  [/^(Conclusion|Conclusions?)$/i, "最后"],
  [/^(研究局限|局限|Limitations?)$/i, "别信太多"],
  [/^(创新点|研究贡献|贡献)$/i, "花活在哪儿"],
  [/^(研究背景|研究意义|背景)$/i, "为啥聊这个"],
  [/^(研究问题|问题的提出)$/i, "事儿是这么来的"],
  [/^(研究对象)$/i, "先看谁"],
  [/^(研究假设|假设)$/i, "先猜一下"],
  [/^(数据来源|数据来源与空间范围)$/i, "数据哪来的"],
  [/^(实验材料)$/i, "拿什么做的"],
  [/^(模型构建)$/i, "怎么搭的"],
  [/^(统计学分析)$/i, "怎么算的"],
  [/^(问题提出|问题的提出)$/i, "事儿是这么来的"],
  [/^(理论框架|分析框架)$/i, "拿什么看"],
  [/^(案例|案例分析)$/i, "举个例子"],
  [/^(小结)$/i, "先说到这"],
  [/^(参考文献|References?)$/i, "提到的"],
  [/^(致谢|Acknowledg(e)?ments?)$/i, "谢幕"],
  [/^(附录|Appendix)$/i, "彩蛋"],
  [/^(摘要|Abstract)$/i, "开场"],
];

export function humanizeFunMarkdown(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      const m = /^(#{2,4})[ \t]+(.+?)[ \t]*$/.exec(line);
      if (!m) return line;
      // 去掉「1」「2.3」「一、」等论文式编号，保留标题本身
      const title = m[2]
        .replace(/^\d+(?:\.\d+)*[.、]?\s*/, "")
        .replace(/^[一二三四五六七八九十]+[、.]\s*/, "")
        .trim();
      const key = title.replace(/[：:]\s*$/u, "");
      const hit = FUN_HEADING_MAP.find(([re]) => re.test(key));
      // 234 篇副刊的标题是作者各自写的，穷举不可能覆盖完。这里做一层
      // 语义兜底：只要标题仍在讲“研究/方法/样本/结果/讨论/结论”，
      // 就换成副刊口吻，正文一个字不动。
      const fallback: Array<[RegExp, string]> = [
        [
          /研究|方法|模型|样本|变量|数据|实证|实验|检验|回归|统计|假设/u,
          "怎么做的",
        ],
        [/结果|发现|效应|显著性/u, "所以呢"],
        [/讨论|局限|反思|不足/u, "聊两句"],
        [/结论|总结|启示|建议/u, "最后"],
        [/背景|问题|缘起|动机/u, "为啥聊这个"],
        [/概念|定义|理论|框架|机制/u, "先把词说清"],
        [/案例|场景|样本/u, "举个例子"],
      ];
      // 兜底只处理“纯学术骨架标题”（研究结果 / 研究结论 / 讨论…）。
      // 带具体限定词的标题（仿真结果、SHA-256-QA 总体结果、讨论：认知过载）
      // 保留原词，否则一页会出现多个“所以呢”，比论文标题更难读。
      const qualifier = key
        .replace(
          /研究|方法|模型|样本|变量|数据|实证|实验|检验|回归|统计|假设|结果|发现|效应|显著性|讨论|局限|反思|不足|结论|总结|启示|建议|背景|问题|缘起|动机|概念|定义|理论|框架|机制|案例|场景/gu,
          "",
        )
        .replace(/[\s\d.、,，:：;；()（）\-—_]+/g, "")
        .trim();
      const fallbackHit =
        qualifier.length === 0
          ? fallback.find(([re]) => re.test(key))
          : undefined;
      const mapped = hit ? hit[1] : fallbackHit ? fallbackHit[1] : title;
      return `${m[1]} ${mapped}`;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// 邮箱脱敏：原稿里 `* zabwerk@yeah.net`、`邮箱：zabwerk@yeah.net` 这类
// 整行移除；行内残留邮箱也删掉。注意不能吃掉邮箱相邻的作者名/字符。
// 用负向后顾确保不从单词中间开始匹配（避免把 Zabwerk 削成 abwerk）。
const EMAIL_LINE_RE =
  /^[ \t>*-]*\s*(?:邮箱[：:]|Email[：:]|E-mail[：:])?\s*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\s*[ \t]*$/gim;
// 行内邮箱：前后不能是字母数字（避免匹配到 XZabwerk@... 里的子串）
const EMAIL_INLINE_RE =
  /(?<![A-Za-z0-9])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9])/g;

export function scrubManuscriptEmails(md: string): string {
  // 1) 整行邮箱（含 * / 邮箱： 前缀）整块删除
  let out = md.replace(EMAIL_LINE_RE, "");
  // 2) 行内残留邮箱删除（不留「未认领」拼接）
  out = out.replace(EMAIL_INLINE_RE, "");
  // 3) 清理因删除留下的孤立列表标记 `* ` 与多余空行
  out = out.replace(/^[ \t]*\*[ \t]*$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

export function headingHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export function splitManuscript(md: string): { main: string; refs: string } {
  const idx = md.lastIndexOf("\n## 参考文献");
  if (idx < 0) {
    if (md.startsWith("## 参考文献")) return { main: "", refs: md };
    return { main: md, refs: "" };
  }
  return { main: md.slice(0, idx), refs: md.slice(idx + 1) };
}

// Word → HTML → Markdown 的转换管线会在插图位置留下
// `<!-- Start of picture text --> … <!-- End of picture text -->` 这类
// 注释，Markdown 渲染时被当成正文显示（生产 /reader/133 实锤）。
// 只在渲染层剥离，不改存储原文。
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

export function stripHtmlComments(md: string): string {
  return md.replace(HTML_COMMENT, "");
}

interface AbstractSplit {
  before: string;
  abstract: string;
  label: string;
  after: string;
}

const ABSTRACT_HEADING =
  /^#{2,3}[ \t]*(摘[ \t\u3000]*要|Abstract|ABSTRACT)(?:[ \t]*[（(][^）)]*[）)])?[ \t]*$/i;
const ABSTRACT_QUOTE =
  /^>[ \t]*(?:\*\*)?[ \t]*(摘[ \t\u3000]*要|Abstract|ABSTRACT)[ \t]*(?:\*\*)?[ \t\u3000:：]*(.*)$/i;
const NEXT_HEADING = /^#{1,3}[ \t]+\S/;
const KEYWORDS_LINE =
  /^(?:\*\*)?[ \t]*(关键词|关键字|Keywords?)(?:\*\*)?[ \t]*[:：]/i;

function abstractLabel(heading: string): string {
  return /^abstract$/i.test(heading.trim()) ? "Abstract" : "摘要";
}

// 摘要从正文流中摘出，交给独立卡片渲染；关键词/下一节/分隔线都视为摘要结束。
// 兼容两种真实稿件结构：清洗后的 `## 摘要` 与存量稿的 `> **摘 要** …`。
export function splitAbstract(md: string): AbstractSplit {
  const lines = md.split("\n");
  const headingAt = lines.findIndex((line) =>
    ABSTRACT_HEADING.test(line.trim()),
  );
  if (headingAt >= 0) {
    const heading =
      ABSTRACT_HEADING.exec(lines[headingAt].trim())?.[1] ?? "摘要";
    let end = lines.length;
    for (let i = headingAt + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (
        NEXT_HEADING.test(line) ||
        KEYWORDS_LINE.test(line) ||
        line === "---"
      ) {
        end = i;
        break;
      }
    }
    const abstract = lines
      .slice(headingAt + 1, end)
      .join("\n")
      .trim();
    if (abstract) {
      return {
        before: lines.slice(0, headingAt).join("\n").trim(),
        abstract,
        label: abstractLabel(heading),
        after: lines.slice(end).join("\n").trim(),
      };
    }
  }

  const quoteAt = lines.findIndex((line) => ABSTRACT_QUOTE.test(line.trim()));
  if (quoteAt >= 0) {
    const heading = ABSTRACT_QUOTE.exec(lines[quoteAt].trim())?.[1] ?? "摘要";
    const body = [ABSTRACT_QUOTE.exec(lines[quoteAt].trim())?.[2] ?? ""];
    let end = quoteAt + 1;
    while (end < lines.length && /^>/.test(lines[end].trim())) {
      const quoted = lines[end].trim().replace(/^>[ \t]?/, "");
      if (KEYWORDS_LINE.test(quoted) || NEXT_HEADING.test(quoted)) break;
      body.push(quoted);
      end++;
    }
    const abstract = body.join("\n").trim();
    if (abstract) {
      return {
        before: lines.slice(0, quoteAt).join("\n").trim(),
        abstract,
        label: abstractLabel(heading),
        after: lines.slice(end).join("\n").trim(),
      };
    }
  }

  return { before: "", abstract: "", label: "摘要", after: md };
}
