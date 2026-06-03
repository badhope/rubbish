#!/usr/bin/env python3
"""Update the sidebar section in docs/.vitepress/config.ts from the filesystem.

Re-scans `papers/computer-science/` and `papers/economics-management/`
and rewrites the `sidebar` block in `docs/.vitepress/config.ts` while
preserving all other configuration.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAPERS = ROOT / "papers"
DOCS = ROOT / "docs"
CONFIG = DOCS / ".vitepress" / "config.ts"

CS_PRETTY = {
    "AI-Safety-Alignment": "AI Safety & Alignment",
    "AI-for-Science": "AI for Science",
    "Algorithms-Data-Structures": "Algorithms & Data Structures",
    "AutoML-NAS": "AutoML & NAS",
    "Causal-Inference": "Causal Inference",
    "Computer-Networks": "Computer Networks",
    "Computer-Security": "Computer Security",
    "Computer-Vision": "Computer Vision",
    "Data-Mining": "Data Mining",
    "Database-Systems": "Database Systems",
    "Deep-Learning": "Deep Learning",
    "Distributed-Systems": "Distributed Systems",
    "Embodied-AI": "Embodied AI",
    "Explainable-AI": "Explainable AI",
    "Generative-Models": "Generative Models",
    "Graph-Neural-Networks": "Graph Neural Networks",
    "Human-Computer-Interaction": "Human-Computer Interaction",
    "Information-Retrieval": "Information Retrieval",
    "Large-Language-Models": "Large Language Models",
    "Machine-Learning": "Machine Learning",
    "Multimodal-Learning": "Multimodal Learning",
    "Natural-Language-Processing": "Natural Language Processing",
    "Operating-Systems": "Operating Systems",
    "Optimization-Theory": "Optimization Theory",
    "Programming-Languages": "Programming Languages",
    "Quantum-Computing": "Quantum Computing",
    "Recommender-Systems": "Recommender Systems",
    "Reinforcement-Learning": "Reinforcement Learning",
    "Software-Engineering": "Software Engineering",
    "Speech-Audio-Processing": "Speech & Audio Processing",
    "Time-Series-Analysis": "Time Series Analysis",
}


def humanize(name: str) -> str:
    """Convert kebab-case to Title Case."""
    return name.replace("-", " ").title()


def slugify(name: str) -> str:
    """Convert a directory name to a URL slug."""
    return name.lower()


def discover_cs_topics(papers_dir: Path) -> list[str]:
    """Find all CS topic directories under papers/computer-science/."""
    cs_dir = papers_dir / "computer-science"
    if not cs_dir.exists():
        return []
    return sorted(
        e.name
        for e in cs_dir.iterdir()
        if e.is_dir() and not e.name.startswith(".")
    )


def discover_em_fields(papers_dir: Path) -> list[str]:
    """Find all EM field directories across year subfolders."""
    em_dir = papers_dir / "economics-management"
    if not em_dir.exists():
        return []
    fields: set[str] = set()
    for y in em_dir.iterdir():
        if y.is_dir() and re.match(r"^\d{4}$", y.name):
            for f in y.iterdir():
                if f.is_dir() and not f.name.startswith("."):
                    fields.add(f.name)
    return sorted(fields)


def build_sidebar_block(
    topics: list[str], pretty_map: dict, label: str, base_path: str
) -> str:
    """Build the TypeScript sidebar block for a single section."""
    lines = [f"      '/{base_path}/': ["]
    lines.append("        {")
    lines.append(f"          text: '{label}',")
    lines.append("          collapsed: false,")
    lines.append("          items: [")
    lines.append(
        f"            {{ text: 'Overview', link: '/{base_path}/index' }},"
    )
    for t in topics:
        pretty = pretty_map.get(t, humanize(t))
        slug = slugify(t)
        lines.append(
            f"            {{ text: {repr(pretty)}, link: '/{base_path}/{slug}' }},"
        )
    lines.append("          ],")
    lines.append("        },")
    lines.append("      ],")
    return "\n".join(lines)


def write_sidebar(config_path: Path, papers_dir: Path) -> tuple[int, int]:
    """Rewrite the sidebar in config.ts. Returns (cs_count, em_count)."""
    cs_topics = discover_cs_topics(papers_dir)
    em_fields = discover_em_fields(papers_dir)

    cs_block = build_sidebar_block(
        cs_topics, CS_PRETTY, "Computer Science", "papers/computer-science"
    )
    em_block = build_sidebar_block(
        em_fields, {}, "Economics & Management", "papers/economics-management"
    )

    new_sidebar = "    sidebar: {\n" + cs_block + "\n" + em_block + "\n    },"

    src = config_path.read_text(encoding="utf-8")
    pattern = re.compile(r"    sidebar: \{[\s\S]*?\n    \},", re.MULTILINE)
    if not pattern.search(src):
        raise SystemExit("Could not find sidebar block in config.ts")

    src = pattern.sub(new_sidebar, src, count=1)
    config_path.write_text(src, encoding="utf-8")
    return len(cs_topics), len(em_fields)


def main() -> int:
    if not CONFIG.exists():
        print(f"Error: config not found: {CONFIG}", file=sys.stderr)
        return 1
    if not PAPERS.exists():
        print(f"Error: papers dir not found: {PAPERS}", file=sys.stderr)
        return 1
    cs_count, em_count = write_sidebar(CONFIG, PAPERS)
    print(f"✓ Updated sidebar: {cs_count} CS topics + {em_count} EM fields")
    return 0


if __name__ == "__main__":
    sys.exit(main())