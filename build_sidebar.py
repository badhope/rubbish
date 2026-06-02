#!/usr/bin/env python3
"""Update only the sidebar section in docs/.vitepress/config.ts, preserving everything else."""
import re, os
from pathlib import Path

ROOT = Path("/workspace/scholarlib-audit")
PAPERS = ROOT / "papers"
DOCS = ROOT / "docs"
CONFIG = DOCS / ".vitepress" / "config.ts"

# ── CS topics ──
cs_dir = PAPERS / "computer-science"
cs_topics = sorted([e.name for e in cs_dir.iterdir() if e.is_dir() and not e.name.startswith('.')])

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

def humanize(name):
    return name.replace('-', ' ').title()

def slugify(name):
    return name.lower()

# ── EM fields ──
em_dir = PAPERS / "economics-management"
em_fields = set()
for y in em_dir.iterdir():
    if y.is_dir() and re.match(r'^\d{4}$', y.name):
        for f in y.iterdir():
            if f.is_dir() and not f.name.startswith('.'):
                em_fields.add(f.name)
em_fields = sorted(em_fields)

# ── Build sidebar TS ──
def build_sidebar_block(topics, pretty_map, label, base_path):
    lines = []
    lines.append(f"      '/{base_path}/': [")
    lines.append(f"        {{")
    lines.append(f"          text: '{label}',")
    lines.append(f"          collapsed: false,")
    lines.append(f"          items: [")
    lines.append(f"            {{ text: 'Overview', link: '/{base_path}/index' }},")
    for t in topics:
        pretty = pretty_map.get(t, humanize(t))
        slug = slugify(t)
        lines.append(f"            {{ text: {repr(pretty)}, link: '/{base_path}/{slug}' }},")
    lines.append(f"          ],")
    lines.append(f"        }},")
    lines.append(f"      ],")
    return '\n'.join(lines)

cs_block = build_sidebar_block(cs_topics, CS_PRETTY, 'Computer Science', 'papers/computer-science')
em_block = build_sidebar_block(em_fields, {}, 'Economics & Management', 'papers/economics-management')

# ── Read current config and replace sidebar ──
src = CONFIG.read_text(encoding='utf-8')
new_sidebar = "    sidebar: {\n" + cs_block + "\n" + em_block + "\n    },"

# Find the current sidebar block
pattern = re.compile(r"    sidebar: \{[\s\S]*?\n    \},", re.MULTILINE)
if not pattern.search(src):
    raise SystemExit("Could not find sidebar block in config.ts")

src = pattern.sub(new_sidebar, src, count=1)
CONFIG.write_text(src, encoding='utf-8')
print(f"✓ Updated sidebar: {len(cs_topics)} CS topics + {len(em_fields)} EM fields")
