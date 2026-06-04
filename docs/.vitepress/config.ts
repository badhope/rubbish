import { defineConfig } from "vitepress";

const repo = "https://github.com/badhope/ScholarLib";
const docsDir = "docs";
const editLinkBase = `${repo}/edit/main/`;

export default defineConfig({
  title: "ScholarLib",
  description:
    "A curated, open-access scholarly library of Computer Science, Economics & Management papers — browse, search, and cite, all in one place.",
  lang: "en-US",
  base: "/ScholarLib/",
  cleanUrls: true,
  lastUpdated: true,
  appearance: "force-auto",
  ignoreDeadLinks: false,

  // VitePress's default srcExclude only filters out `**/README.md` and
  // `**/readme.md`; it does NOT exclude `docs/public/` itself. We mirror
  // paper PDFs (and, previously, leaf READMEs) into `docs/public/papers/`
  // so the site can serve them at /papers/.../<filename>. If anyone ever
  // drops a `.md` into `docs/public/`, VitePress would silently render it
  // as a stray page (`/public/.../<name>.html`) and pollute the SPA hash
  // map. Exclude the whole subtree defensively.
  srcExclude: ["**/public/**"],

  // ── Head: meta tags, OG, Twitter card, canonical, JSON-LD ─────────────
  head: [
    ["meta", { charset: "utf-8" }],
    [
      "meta",
      { name: "viewport", content: "width=device-width,initial-scale=1" },
    ],
    ["meta", { name: "theme-color", content: "#3b82f6" }],
    ["meta", { name: "color-scheme", content: "light dark" }],

    // Primary SEO
    [
      "meta",
      {
        name: "description",
        content:
          "A curated, open-access scholarly library of Computer Science, Economics & Management papers.",
      },
    ],
    [
      "meta",
      {
        name: "keywords",
        content:
          "academic papers, computer science, economics, management, open access, research library, scholarly articles, deep learning, machine learning, finance, marketing, bibliography",
      },
    ],
    ["meta", { name: "author", content: "badhope" }],
    ["meta", { name: "robots", content: "index,follow" }],

    // Canonical
    [
      "link",
      { rel: "canonical", href: "https://badhope.github.io/ScholarLib/" },
    ],

    // Open Graph
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "ScholarLib" }],
    [
      "meta",
      {
        property: "og:title",
        content: "ScholarLib — Open-Access Paper Library",
      },
    ],
    [
      "meta",
      {
        property: "og:description",
        content:
          "Browse, search, and cite curated open-access papers in Computer Science, Economics & Management.",
      },
    ],
    [
      "meta",
      { property: "og:url", content: "https://badhope.github.io/ScholarLib/" },
    ],
    [
      "meta",
      {
        property: "og:image",
        content: "https://badhope.github.io/ScholarLib/og-image.png",
      },
    ],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { property: "og:locale", content: "en_US" }],

    // Twitter Card
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    [
      "meta",
      {
        name: "twitter:title",
        content: "ScholarLib — Open-Access Paper Library",
      },
    ],
    [
      "meta",
      {
        name: "twitter:description",
        content: "Browse, search, and cite curated open-access papers.",
      },
    ],
    [
      "meta",
      {
        name: "twitter:image",
        content: "https://badhope.github.io/ScholarLib/og-image.png",
      },
    ],

    // JSON-LD structured data
    [
      "script",
      { type: "application/ld+json" },
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "ScholarLib",
        description:
          "A curated, open-access scholarly library of Computer Science, Economics & Management papers.",
        url: "https://badhope.github.io/ScholarLib/",
        author: {
          "@type": "Person",
          name: "badhope",
          url: "https://github.com/badhope",
        },
        license: "https://opensource.org/licenses/MIT",
        potentialAction: {
          "@type": "SearchAction",
          target:
            "https://badhope.github.io/ScholarLib/?q={search_term_string}",
          "query-input": "required name=search_term_string",
        },
      }),
    ],

    // PWA manifest
    [
      "link",
      {
        rel: "manifest",
        href: "https://badhope.github.io/ScholarLib/manifest.webmanifest",
      },
    ],
    ["meta", { name: "apple-mobile-web-app-capable", content: "yes" }],
    [
      "meta",
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    ],
    ["meta", { name: "apple-mobile-web-app-title", content: "ScholarLib" }],
    ["meta", { name: "mobile-web-app-capable", content: "yes" }],
    ["meta", { name: "application-name", content: "ScholarLib" }],
    ["meta", { name: "format-detection", content: "telephone=no" }],

    // Icons
    [
      "link",
      { rel: "icon", type: "image/svg+xml", href: "/ScholarLib/favicon.svg" },
    ],
    ["link", { rel: "alternate icon", href: "/ScholarLib/favicon.ico" }],
    ["link", { rel: "apple-touch-icon", href: "/ScholarLib/pwa-192.png" }],

    // RSS feed auto-discovery
    [
      "link",
      {
        rel: "alternate",
        type: "application/rss+xml",
        title: "ScholarLib",
        href: "https://badhope.github.io/ScholarLib/rss.xml",
      },
    ],

    // Sitemap auto-discovery
    [
      "link",
      {
        rel: "sitemap",
        type: "application/xml",
        title: "Sitemap",
        href: "https://badhope.github.io/ScholarLib/sitemap.xml",
      },
    ],
  ],

  // ── Markdown extensions ──────────────────────────────────────────────
  markdown: {
    lineNumbers: false,
    theme: { light: "github-light", dark: "github-dark" },
  },

  // ── Internationalization (i18n) ─────────────────────────────────────
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      description:
        "A curated, open-access scholarly library of Computer Science, Economics & Management papers — browse, search, and cite, all in one place.",
      themeConfig: {
        nav: [
          { text: "Home", link: "/" },
          { text: "Computer Science", link: "/papers/computer-science/index" },
          {
            text: "Economics & Management",
            link: "/papers/economics-management/index",
          },
          { text: "Citation Graph", link: "/citation-graph" },
          { text: "About", link: "/about" },
        ],
      },
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      // No `link:` here on purpose: with `i18nRouting: true` (the default
      // in themeConfig below) the language switcher will map the current
      // en path to its zh counterpart, and a zh stub now exists for every
      // en topic page — so the switcher always lands on a real page.
      description:
        "精选开放获取的计算机科学、经济学与管理学论文库 — 浏览、检索、引用，一站式搞定。",
      themeConfig: {
        nav: [
          { text: "首页", link: "/zh/" },
          { text: "计算机科学", link: "/zh/papers/computer-science/index" },
          { text: "经济与管理", link: "/zh/papers/economics-management/index" },
          { text: "关于", link: "/zh/about" },
        ],
        // zh has no per-topic subpages, so the topic sidebar only renders
        // on the two landing pages and lists the en counterparts (which do
        // exist) under Chinese labels. /zh/citation-graph is intentionally
        // absent — citation-graph.md is en-only.
        sidebar: {
          "/zh/papers/computer-science/": [
            {
              text: "计算机科学",
              collapsed: false,
              items: [
                { text: "概览", link: "/zh/papers/computer-science/index" },
                {
                  text: "AI 安全与对齐",
                  link: "/papers/computer-science/ai-safety-alignment",
                },
                {
                  text: "AI for Science",
                  link: "/papers/computer-science/ai-for-science",
                },
                {
                  text: "算法与数据结构",
                  link: "/papers/computer-science/algorithms-data-structures",
                },
                {
                  text: "AutoML 与 NAS",
                  link: "/papers/computer-science/automl-nas",
                },
                {
                  text: "生物信息学",
                  link: "/papers/computer-science/bioinformatics",
                },
                {
                  text: "因果推断",
                  link: "/papers/computer-science/causal-inference",
                },
                {
                  text: "计算机网络",
                  link: "/papers/computer-science/computer-networks",
                },
                {
                  text: "计算机安全",
                  link: "/papers/computer-science/computer-security",
                },
                {
                  text: "计算机视觉",
                  link: "/papers/computer-science/computer-vision",
                },
                {
                  text: "数据挖掘",
                  link: "/papers/computer-science/data-mining",
                },
                {
                  text: "数据库系统",
                  link: "/papers/computer-science/database-systems",
                },
                {
                  text: "深度学习",
                  link: "/papers/computer-science/deep-learning",
                },
                {
                  text: "分布式系统",
                  link: "/papers/computer-science/distributed-systems",
                },
                {
                  text: "具身智能",
                  link: "/papers/computer-science/embodied-ai",
                },
                {
                  text: "可解释 AI",
                  link: "/papers/computer-science/explainable-ai",
                },
                {
                  text: "生成模型",
                  link: "/papers/computer-science/generative-models",
                },
                {
                  text: "图神经网络",
                  link: "/papers/computer-science/graph-neural-networks",
                },
                {
                  text: "人机交互",
                  link: "/papers/computer-science/human-computer-interaction",
                },
                {
                  text: "信息检索",
                  link: "/papers/computer-science/information-retrieval",
                },
                {
                  text: "大语言模型",
                  link: "/papers/computer-science/large-language-models",
                },
                {
                  text: "机器学习",
                  link: "/papers/computer-science/machine-learning",
                },
                {
                  text: "多模态学习",
                  link: "/papers/computer-science/multimodal-learning",
                },
                {
                  text: "自然语言处理",
                  link: "/papers/computer-science/natural-language-processing",
                },
                {
                  text: "操作系统",
                  link: "/papers/computer-science/operating-systems",
                },
                {
                  text: "优化理论",
                  link: "/papers/computer-science/optimization-theory",
                },
                {
                  text: "编程语言",
                  link: "/papers/computer-science/programming-languages",
                },
                {
                  text: "量子计算",
                  link: "/papers/computer-science/quantum-computing",
                },
                {
                  text: "推荐系统",
                  link: "/papers/computer-science/recommender-systems",
                },
                {
                  text: "强化学习",
                  link: "/papers/computer-science/reinforcement-learning",
                },
                { text: "机器人", link: "/papers/computer-science/robotics" },
                {
                  text: "软件工程",
                  link: "/papers/computer-science/software-engineering",
                },
                {
                  text: "语音与音频处理",
                  link: "/papers/computer-science/speech-audio-processing",
                },
                {
                  text: "时间序列分析",
                  link: "/papers/computer-science/time-series-analysis",
                },
              ],
            },
          ],
          "/zh/papers/economics-management/": [
            {
              text: "经济与管理",
              collapsed: false,
              items: [
                { text: "概览", link: "/zh/papers/economics-management/index" },
                {
                  text: "会计学",
                  link: "/papers/economics-management/accounting",
                },
                {
                  text: "行为经济学",
                  link: "/papers/economics-management/behavioral-economics",
                },
                {
                  text: "数字经济",
                  link: "/papers/economics-management/digital-economy",
                },
                {
                  text: "ESG 与可持续",
                  link: "/papers/economics-management/esg-sustainability",
                },
                {
                  text: "金融学",
                  link: "/papers/economics-management/finance",
                },
                {
                  text: "健康经济学",
                  link: "/papers/economics-management/health-economics",
                },
                {
                  text: "人力资源",
                  link: "/papers/economics-management/human-resources",
                },
                {
                  text: "创新与创业",
                  link: "/papers/economics-management/innovation-entrepreneurship",
                },
                {
                  text: "国际商务",
                  link: "/papers/economics-management/international-business",
                },
                {
                  text: "劳动经济学",
                  link: "/papers/economics-management/labor-economics",
                },
                {
                  text: "宏观经济学",
                  link: "/papers/economics-management/macroeconomics",
                },
                {
                  text: "市场营销",
                  link: "/papers/economics-management/marketing",
                },
                {
                  text: "微观经济学",
                  link: "/papers/economics-management/microeconomics",
                },
                {
                  text: "运营管理",
                  link: "/papers/economics-management/operations-management",
                },
                {
                  text: "公共经济学",
                  link: "/papers/economics-management/public-economics",
                },
                {
                  text: "房地产与城市经济学",
                  link: "/papers/economics-management/real-estate-urban-economics",
                },
                {
                  text: "战略管理",
                  link: "/papers/economics-management/strategic-management",
                },
                {
                  text: "旅游与酒店",
                  link: "/papers/economics-management/tourism-hospitality",
                },
              ],
            },
          ],
          "/zh/": [
            {
              text: "ScholarLib",
              collapsed: false,
              items: [
                { text: "首页", link: "/zh/" },
                {
                  text: "计算机科学",
                  link: "/zh/papers/computer-science/index",
                },
                {
                  text: "经济与管理",
                  link: "/zh/papers/economics-management/index",
                },
                { text: "关于", link: "/zh/about" },
              ],
            },
          ],
        },
      },
    },
  },

  // ── Theme configuration ─────────────────────────────────────────────
  themeConfig: {
    siteTitle: "ScholarLib",

    nav: [
      { text: "Home", link: "/" },
      { text: "Computer Science", link: "/papers/computer-science/index" },
      {
        text: "Economics & Management",
        link: "/papers/economics-management/index",
      },
      { text: "Citation Graph", link: "/citation-graph" },
      { text: "About", link: "/about" },
    ],

    sidebar: {
      "/papers/computer-science/": [
        {
          text: "Computer Science",
          collapsed: false,
          items: [
            { text: "Overview", link: "/papers/computer-science/index" },
            {
              text: "AI Safety & Alignment",
              link: "/papers/computer-science/ai-safety-alignment",
            },
            {
              text: "AI for Science",
              link: "/papers/computer-science/ai-for-science",
            },
            {
              text: "Algorithms & Data Structures",
              link: "/papers/computer-science/algorithms-data-structures",
            },
            {
              text: "AutoML & NAS",
              link: "/papers/computer-science/automl-nas",
            },
            {
              text: "Bioinformatics",
              link: "/papers/computer-science/bioinformatics",
            },
            {
              text: "Causal Inference",
              link: "/papers/computer-science/causal-inference",
            },
            {
              text: "Computer Networks",
              link: "/papers/computer-science/computer-networks",
            },
            {
              text: "Computer Security",
              link: "/papers/computer-science/computer-security",
            },
            {
              text: "Computer Vision",
              link: "/papers/computer-science/computer-vision",
            },
            {
              text: "Data Mining",
              link: "/papers/computer-science/data-mining",
            },
            {
              text: "Database Systems",
              link: "/papers/computer-science/database-systems",
            },
            {
              text: "Deep Learning",
              link: "/papers/computer-science/deep-learning",
            },
            {
              text: "Distributed Systems",
              link: "/papers/computer-science/distributed-systems",
            },
            {
              text: "Embodied AI",
              link: "/papers/computer-science/embodied-ai",
            },
            {
              text: "Explainable AI",
              link: "/papers/computer-science/explainable-ai",
            },
            {
              text: "Generative Models",
              link: "/papers/computer-science/generative-models",
            },
            {
              text: "Graph Neural Networks",
              link: "/papers/computer-science/graph-neural-networks",
            },
            {
              text: "Human-Computer Interaction",
              link: "/papers/computer-science/human-computer-interaction",
            },
            {
              text: "Information Retrieval",
              link: "/papers/computer-science/information-retrieval",
            },
            {
              text: "Large Language Models",
              link: "/papers/computer-science/large-language-models",
            },
            {
              text: "Machine Learning",
              link: "/papers/computer-science/machine-learning",
            },
            {
              text: "Multimodal Learning",
              link: "/papers/computer-science/multimodal-learning",
            },
            {
              text: "Natural Language Processing",
              link: "/papers/computer-science/natural-language-processing",
            },
            {
              text: "Operating Systems",
              link: "/papers/computer-science/operating-systems",
            },
            {
              text: "Optimization Theory",
              link: "/papers/computer-science/optimization-theory",
            },
            {
              text: "Programming Languages",
              link: "/papers/computer-science/programming-languages",
            },
            {
              text: "Quantum Computing",
              link: "/papers/computer-science/quantum-computing",
            },
            {
              text: "Recommender Systems",
              link: "/papers/computer-science/recommender-systems",
            },
            {
              text: "Reinforcement Learning",
              link: "/papers/computer-science/reinforcement-learning",
            },
            { text: "Robotics", link: "/papers/computer-science/robotics" },
            {
              text: "Software Engineering",
              link: "/papers/computer-science/software-engineering",
            },
            {
              text: "Speech & Audio Processing",
              link: "/papers/computer-science/speech-audio-processing",
            },
            {
              text: "Time Series Analysis",
              link: "/papers/computer-science/time-series-analysis",
            },
          ],
        },
      ],
      "/papers/economics-management/": [
        {
          text: "Economics & Management",
          collapsed: false,
          items: [
            { text: "Overview", link: "/papers/economics-management/index" },
            {
              text: "Accounting",
              link: "/papers/economics-management/accounting",
            },
            {
              text: "Behavioral Economics",
              link: "/papers/economics-management/behavioral-economics",
            },
            {
              text: "Digital Economy",
              link: "/papers/economics-management/digital-economy",
            },
            {
              text: "Esg Sustainability",
              link: "/papers/economics-management/esg-sustainability",
            },
            { text: "Finance", link: "/papers/economics-management/finance" },
            {
              text: "Health Economics",
              link: "/papers/economics-management/health-economics",
            },
            {
              text: "Human Resources",
              link: "/papers/economics-management/human-resources",
            },
            {
              text: "Innovation Entrepreneurship",
              link: "/papers/economics-management/innovation-entrepreneurship",
            },
            {
              text: "International Business",
              link: "/papers/economics-management/international-business",
            },
            {
              text: "Labor Economics",
              link: "/papers/economics-management/labor-economics",
            },
            {
              text: "Macroeconomics",
              link: "/papers/economics-management/macroeconomics",
            },
            {
              text: "Marketing",
              link: "/papers/economics-management/marketing",
            },
            {
              text: "Microeconomics",
              link: "/papers/economics-management/microeconomics",
            },
            {
              text: "Operations Management",
              link: "/papers/economics-management/operations-management",
            },
            {
              text: "Public Economics",
              link: "/papers/economics-management/public-economics",
            },
            {
              text: "Real Estate Urban Economics",
              link: "/papers/economics-management/real-estate-urban-economics",
            },
            {
              text: "Strategic Management",
              link: "/papers/economics-management/strategic-management",
            },
            {
              text: "Tourism Hospitality",
              link: "/papers/economics-management/tourism-hospitality",
            },
          ],
        },
      ],
      "/about/": [
        {
          text: "About",
          collapsed: false,
          items: [
            { text: "Overview", link: "/about" },
            { text: "License", link: "/about#license" },
            { text: "Contributing", link: "/about#contributing" },
            { text: "History", link: "/about#history" },
            { text: "Maintainer", link: "/about#maintainer" },
          ],
        },
      ],
    },

    outline: { level: [2, 3], label: "On this page" },

    docFooter: {
      prev: "Previous",
      next: "Next",
    },

    socialLinks: [{ icon: "github", link: repo }],

    footer: {
      message: "Released under the MIT License.",
      copyright: `Copyright © ${new Date().getFullYear()} badhope`,
    },

    editLink: {
      pattern: `${editLinkBase}${docsDir}/:path`,
      text: "Edit this page on GitHub",
    },

    lastUpdated: {
      text: "Last updated",
      formatOptions: { dateStyle: "long", timeStyle: "short" },
    },

    search: {
      provider: "local",
      options: {
        detailedView: true,
        miniSearch: {
          searchOptions: {
            fuzzy: 0.2,
            prefix: true,
            boost: { title: 4, text: 1 },
          },
        },
      },
    },

    // Re-enable lang-switcher path auto-mapping. The previous setting
    // (`i18nRouting: false`) was a stop-gap: it forced every zh
    // switcher click to go to the zh home, which worked once but left
    // zh users stranded on an en topic page unable to read the same
    // page in Chinese. Now that a zh stub exists for every en topic
    // (see scripts/generate_zh_topic_stubs.py), the auto-mapper is
    // safe again — every /papers/cs/foo → /zh/papers/cs/foo lands on
    // a real page.
    i18nRouting: true,
  },

  // ── Sitemap generation ──────────────────────────────────────────────
  sitemap: {
    hostname: "https://badhope.github.io/ScholarLib/",
  },

  // ── Build performance ───────────────────────────────────────────────
  buildEnd: async () => {
    console.log(`✓ ScholarLib site built successfully`);
  },
});
