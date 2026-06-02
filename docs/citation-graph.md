---
title: Citation Graph
aside: false
outline: false
---

<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  // Load graph data and render visualization
  const container = document.getElementById('citation-graph-viz')
  if (!container) return

  fetch('/ScholarLib/data/citation-graph.json')
    .then(r => r.json())
    .then(data => {
      renderGraph(container, data)
    })
    .catch(err => {
      container.innerHTML = '<p style="color:red;text-align:center">Failed to load citation graph data.</p>'
    })
})

function renderGraph(container, data) {
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
  const nodes = data.nodes.map((n, i) => ({
    ...n,
    x: Math.random() * width,
    y: Math.random() * height,
    vx: 0, vy: 0,
    radius: 4 + Math.min(n.title.length / 10, 8),
  }))

  // Simple layout simulation
  function simulate() {
    const centerX = width / 2
    const centerY = height / 2
    for (const n of nodes) {
      // Center gravity
      n.vx += (centerX - n.x) * 0.001
      n.vy += (centerY - n.y) * 0.001
      // Damping
      n.vx *= 0.9
      n.vy *= 0.9
      n.x += n.vx
      n.y += n.vy
    }

    // Draw
    ctx.clearRect(0, 0, width, height)
    
    // Draw edges (if any)
    if (data.edges) {
      ctx.strokeStyle = 'rgba(100,100,255,0.15)'
      ctx.lineWidth = 0.5
      for (const e of data.edges) {
        const s = nodes.find(n => n.id === e.source)
        const t = nodes.find(n => n.id === e.target)
        if (s && t) {
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(t.x, t.y)
          ctx.stroke()
        }
      }
    }

    // Draw nodes
    for (const n of nodes) {
      const hue = (n.topic === 'computer-science' ? 210 : 40)
      ctx.fillStyle = `hsla(${hue}, 80%, 55%, 0.7)`
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
      ctx.fill()
    }

    requestAnimationFrame(simulate)
  }
  simulate()
}
</script>

# Citation Graph

> **46 papers** across **2 topics**, **4** years of research.

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
| 2016 | 1 |
| 2024 | 2 |
| 2025 | 31 |
| 2026 | 12 |

</div>

## Top Keywords

<div class="stats-grid">

| Keyword | Occurrences |
|--------:|------------:|
| meta-analysis | 5 |
| organizational behavior | 3 |
| field experiment | 2 |
| firm performance | 2 |
| climate change | 2 |
| competition | 2 |
| artificial intelligence | 2 |
| value creation | 2 |
| human resource management | 2 |
| diversity | 2 |
| employee outcomes | 2 |
| employee voice | 2 |
| motivation | 2 |
| performance | 2 |
| hiring | 2 |
| personnel selection | 2 |
| sustainability reporting | 1 |
| esg disclosure | 1 |
| emerging markets | 1 |
| reporting quality | 1 |
| institutional factors | 1 |
| behavioral nudges | 1 |
| student loans | 1 |
| delinquency | 1 |
| education finance | 1 |
| business value | 1 |
| capability alignment | 1 |
| digital strategy | 1 |
| implementation | 1 |
| productivity | 1 |

</div>

## Top Journals

<div class="stats-grid">

| Journal | Papers |
|--------:|-------:|
| Human Resource Management | 4 |
| Journal of Organizational Behavior | 3 |
| Journal of Finance | 2 |
| Journal of International Business Studies | 2 |
| Academy of Management Review | 2 |
| Leadership Quarterly | 2 |
| Journal of Marketing Research | 2 |
| Strategic Management Journal | 2 |
| Annals of Tourism Research | 2 |
| Proceedings of the 22nd ACM SIGKDD International Conference on Knowledge Discovery and Data Mining | 1 |
| Accounting Horizons | 1 |
| Proceedings of the National Academy of Sciences | 1 |
| MIS Quarterly | 1 |
| Research Policy | 1 |
| Corporate Social Responsibility and Environmental Management | 1 |

</div>

## Topic Distribution

<div class="stats-grid">

| Topic | Papers |
|------:|-------:|
| economics-management/2026 | 45 |
| computer-science/Machine-Learning | 1 |

</div>
