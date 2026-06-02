#!/usr/bin/env python3
"""Citation Graph Generator for ScholarLib.

Parses all .bib files in papers/, extracts citation relationships,
and generates:
  1. A JSON graph file (for D3.js / vis.js rendering)
  2. A Markdown page with citation statistics

Usage:
  python3 scripts/generate_citation_graph.py
  python3 scripts/generate_citation_graph.py --topic machine-learning
  python3 scripts/generate_citation_graph.py --output-dir docs/public/data
"""

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAPERS_DIR = ROOT / "papers"
OUTPUT_DIR = ROOT / "docs" / "public" / "data"


def parse_bibtex(content: str) -> dict:
    """Extract fields from a BibTeX entry."""
    fields = {}
    # Extract title
    m = re.search(r'title\s*=\s*[{"]+(.+?)[}"]+', content, re.DOTALL | re.IGNORECASE)
    if m:
        fields["title"] = re.sub(r'\s+', ' ', m.group(1).strip())
    
    # Extract author
    m = re.search(r'author\s*=\s*[{"]+(.+?)[}"]+', content, re.DOTALL | re.IGNORECASE)
    if m:
        fields["author"] = m.group(1).strip()
    
    # Extract year
    m = re.search(r'year\s*=\s*[{"]*(\d{4})[}"]*', content, re.IGNORECASE)
    if m:
        fields["year"] = m.group(1)
    
    # Extract journal/booktitle
    m = re.search(r'(?:journal|booktitle)\s*=\s*[{"]+(.+?)[}"]+', content, re.DOTALL | re.IGNORECASE)
    if m:
        fields["journal"] = m.group(1).strip()
    
    # Extract DOI
    m = re.search(r'doi\s*=\s*[{"]+(.+?)[}"]+', content, re.DOTALL | re.IGNORECASE)
    if m:
        fields["doi"] = m.group(1).strip()

    # Extract keywords
    m = re.search(r'keywords\s*=\s*[{"]+(.+?)[}"]+', content, re.DOTALL | re.IGNORECASE)
    if m:
        fields["keywords"] = m.group(1).strip()

    # Extract cite key (the @article{KEY, part)
    m = re.search(r'@\w+\{(\w+)', content)
    if m:
        fields["cite_key"] = m.group(1)

    return fields


def find_all_bibs(topic_filter: str | None = None) -> list[Path]:
    """Find all .bib files."""
    files = sorted(PAPERS_DIR.glob("**/*.bib"))
    if topic_filter:
        files = [f for f in files if f"/{topic_filter}/" in str(f)]
    return files


def build_graph(bib_files: list[Path]) -> dict:
    """Build citation graph from all .bib files."""
    nodes = []
    edges = []
    node_ids = set()
    keyword_counter = Counter()
    journal_counter = Counter()
    year_counter = Counter()
    topic_paper_count = Counter()

    for bib_path in bib_files:
        try:
            with open(bib_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except OSError:
            continue
        
        fields = parse_bibtex(content)
        if not fields.get("cite_key"):
            continue

        paper_id = fields["cite_key"]
        if paper_id in node_ids:
            continue
        node_ids.add(paper_id)

        # Determine topic from path
        rel = bib_path.relative_to(PAPERS_DIR)
        parts = rel.parts
        section = parts[0] if parts else "unknown"

        # For CS: parts = [topic, year, ...]
        # For EM: parts = [year, field, topic, ..., paper]
        if section == "computer-science":
            topic = parts[0] + "/" + (parts[1] if len(parts) > 1 else "unknown")
            topic_paper_count[topic] += 1
        else:
            topic = parts[0] if parts else "unknown"
            if len(parts) > 1:
                topic += "/" + parts[1]
            topic_paper_count[topic] += 1

        # Keywords
        kw = fields.get("keywords", "")
        for k in re.split(r'[,;]', kw):
            k = k.strip().lower()
            if k and len(k) > 2:
                keyword_counter[k] += 1

        # Journal
        j = fields.get("journal", "")
        if j:
            journal_counter[j] += 1

        # Year
        y = fields.get("year", "")
        if y:
            year_counter[y] += 1

        node = {
            "id": paper_id,
            "title": fields.get("title", paper_id),
            "author": fields.get("author", ""),
            "year": fields.get("year", ""),
            "journal": fields.get("journal", ""),
            "topic": section,
            "keywords": fields.get("keywords", ""),
        }
        nodes.append(node)

    # Sort nodes by year
    nodes.sort(key=lambda n: n.get("year", "0"))

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "total_papers": len(nodes),
            "total_keywords": len(keyword_counter),
            "total_journals": len(journal_counter),
            "year_distribution": dict(sorted(year_counter.items())),
            "top_keywords": dict(keyword_counter.most_common(50)),
            "top_journals": dict(journal_counter.most_common(20)),
            "topic_distribution": dict(topic_paper_count.most_common()),
        }
    }


def generate_markdown_page(graph: dict) -> str:
    """Generate a VitePress markdown page for citation graph visualization."""
    stats = graph["stats"]
    
    years = len(stats.get("year_distribution", {}))
    topics = len(stats.get("topic_distribution", {}))
    total = stats['total_papers']
    
    md = f"""---
title: Citation Graph
aside: false
outline: false
---

<script setup>
import {{ onMounted }} from 'vue'

onMounted(() => {{
  // Load graph data and render visualization
  const container = document.getElementById('citation-graph-viz')
  if (!container) return

  fetch('/ScholarLib/data/citation-graph.json')
    .then(r => r.json())
    .then(data => {{
      renderGraph(container, data)
    }})
    .catch(err => {{
      container.innerHTML = '<p style="color:red;text-align:center">Failed to load citation graph data.</p>'
    }})
}})

function renderGraph(container, data) {{
  // Simple force-directed layout using Canvas
  const width = container.clientWidth || 800
  const height = 600
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.style.width = '100%'
  canvas.style.height = 'auto'
  container.innerHTML = ''
  container.appendChild(canvas)
  
  const ctx = canvas.getContext('2d')
  const nodes = data.nodes.map((n, i) => ({{
    ...n,
    x: Math.random() * width,
    y: Math.random() * height,
    vx: 0, vy: 0,
    radius: 4 + Math.min(n.title.length / 10, 8),
  }}))

  // Simple layout simulation
  function simulate() {{
    const centerX = width / 2
    const centerY = height / 2
    for (const n of nodes) {{
      // Center gravity
      n.vx += (centerX - n.x) * 0.001
      n.vy += (centerY - n.y) * 0.001
      // Damping
      n.vx *= 0.9
      n.vy *= 0.9
      n.x += n.vx
      n.y += n.vy
    }}

    // Draw
    ctx.clearRect(0, 0, width, height)
    
    // Draw edges (if any)
    if (data.edges) {{
      ctx.strokeStyle = 'rgba(100,100,255,0.15)'
      ctx.lineWidth = 0.5
      for (const e of data.edges) {{
        const s = nodes.find(n => n.id === e.source)
        const t = nodes.find(n => n.id === e.target)
        if (s && t) {{
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(t.x, t.y)
          ctx.stroke()
        }}
      }}
    }}

    // Draw nodes
    for (const n of nodes) {{
      const hue = (n.topic === 'computer-science' ? 210 : 40)
      ctx.fillStyle = `hsla(${{hue}}, 80%, 55%, 0.7)`
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
      ctx.fill()
    }}

    requestAnimationFrame(simulate)
  }}
  simulate()
}}
</script>

# Citation Graph

> **{total} papers** across **{topics} topics**, **{years}** years of research.

<div id="citation-graph-viz" style="
  width: 100%; min-height: 600px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  margin: 1rem 0;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
"></div>

## Distribution by Year

<div class="stats-grid">

| Year | Papers |
|-----:|-------:|
"""
    for year, count in sorted(stats.get("year_distribution", {}).items()):
        md += f"| {year} | {count} |\n"
    
    md += """
</div>

## Top Keywords

<div class="stats-grid">

| Keyword | Occurrences |
|--------:|------------:|
"""
    for kw, count in list(stats.get("top_keywords", {}).items())[:30]:
        md += f"| {kw} | {count} |\n"
    
    md += """
</div>

## Top Journals

<div class="stats-grid">

| Journal | Papers |
|--------:|-------:|
"""
    for j, count in list(stats.get("top_journals", {}).items())[:15]:
        md += f"| {j} | {count} |\n"
    
    md += """
</div>

## Topic Distribution

<div class="stats-grid">

| Topic | Papers |
|------:|-------:|
"""
    for topic, count in sorted(stats.get("topic_distribution", {}).items(), key=lambda x: -x[1]):
        md += f"| {topic} | {count} |\n"
    
    md += "\n</div>\n"
    
    return md


def main():
    parser = argparse.ArgumentParser(description="ScholarLib Citation Graph Generator")
    parser.add_argument("--topic", type=str, help="Filter by topic")
    parser.add_argument("--output-dir", type=str, default=str(OUTPUT_DIR), help="Output directory")
    args = parser.parse_args()

    bib_files = find_all_bibs(args.topic)
    print(f"\nFound {len(bib_files)} .bib files")

    graph = build_graph(bib_files)
    print(f"Graph: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges")

    # Ensure output directory
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Write JSON graph
    json_path = out_dir / "citation-graph.json"
    with open(json_path, "w") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
    print(f"✓ JSON graph saved to {json_path}")

    # Generate markdown page
    md = generate_markdown_page(graph)
    md_path = ROOT / "docs" / "citation-graph.md"
    with open(md_path, "w") as f:
        f.write(md)
    print(f"✓ Markdown page saved to {md_path.relative_to(ROOT)}")

    # Print stats
    stats = graph["stats"]
    print(f"\n{'='*60}")
    print(f"Stats: {stats['total_papers']} papers, "
          f"{stats['total_keywords']} unique keywords, "
          f"{stats['total_journals']} journals")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()