import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ScholarLib',
  description: 'A curated, open-access scholarly library of Computer Science, Economics & Management papers — browse, search, and cite, all in one place.',
  lang: 'en-US',
  base: '/ScholarLib/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#3b82f6' }],
    ['meta', { property: 'og:title', content: 'ScholarLib — Open-Access Paper Library' }],
    ['meta', { property: 'og:description', content: 'A curated, open-access scholarly library of CS, Economics & Management papers.' }],
    ['meta', { property: 'og:type', content: 'website' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Computer Science', link: '/papers/computer-science/index' },
      { text: 'Economics & Management', link: '/papers/economics-management/index' },
      { text: 'About', link: '/about' },
    ],
    sidebar: {
      '/papers/computer-science/': [
  {
    "text": "Computer Science",
    "collapsed": false,
    "items": [
      {
        "text": "Overview",
        "link": "/papers/computer-science/index"
      },
      {
        "text": "AI Safety & Alignment (73)",
        "link": "/papers/computer-science/ai-safety-alignment"
      },
      {
        "text": "AI for Science (73)",
        "link": "/papers/computer-science/ai-for-science"
      },
      {
        "text": "Algorithms & Data Structures (81)",
        "link": "/papers/computer-science/algorithms-data-structures"
      },
      {
        "text": "AutoML & NAS (74)",
        "link": "/papers/computer-science/automl-nas"
      },
      {
        "text": "Bioinformatics (9)",
        "link": "/papers/computer-science/bioinformatics"
      },
      {
        "text": "Causal Inference (73)",
        "link": "/papers/computer-science/causal-inference"
      },
      {
        "text": "Computer Networks (81)",
        "link": "/papers/computer-science/computer-networks"
      },
      {
        "text": "Computer Security (81)",
        "link": "/papers/computer-science/computer-security"
      },
      {
        "text": "Computer Vision (82)",
        "link": "/papers/computer-science/computer-vision"
      },
      {
        "text": "Data Mining (73)",
        "link": "/papers/computer-science/data-mining"
      },
      {
        "text": "Database Systems (81)",
        "link": "/papers/computer-science/database-systems"
      },
      {
        "text": "Deep Learning (82)",
        "link": "/papers/computer-science/deep-learning"
      },
      {
        "text": "Distributed Systems (81)",
        "link": "/papers/computer-science/distributed-systems"
      },
      {
        "text": "Embodied AI (73)",
        "link": "/papers/computer-science/embodied-ai"
      },
      {
        "text": "Explainable AI (73)",
        "link": "/papers/computer-science/explainable-ai"
      },
      {
        "text": "Generative Models (81)",
        "link": "/papers/computer-science/generative-models"
      },
      {
        "text": "Graph Neural Networks (81)",
        "link": "/papers/computer-science/graph-neural-networks"
      },
      {
        "text": "Human-Computer Interaction (81)",
        "link": "/papers/computer-science/human-computer-interaction"
      },
      {
        "text": "Information Retrieval (74)",
        "link": "/papers/computer-science/information-retrieval"
      },
      {
        "text": "Large Language Models (81)",
        "link": "/papers/computer-science/large-language-models"
      },
      {
        "text": "Machine Learning (77)",
        "link": "/papers/computer-science/machine-learning"
      },
      {
        "text": "Multimodal Learning (73)",
        "link": "/papers/computer-science/multimodal-learning"
      },
      {
        "text": "Natural Language Processing (81)",
        "link": "/papers/computer-science/natural-language-processing"
      },
      {
        "text": "Operating Systems (81)",
        "link": "/papers/computer-science/operating-systems"
      },
      {
        "text": "Optimization Theory (74)",
        "link": "/papers/computer-science/optimization-theory"
      },
      {
        "text": "Programming Languages (81)",
        "link": "/papers/computer-science/programming-languages"
      },
      {
        "text": "Quantum Computing (81)",
        "link": "/papers/computer-science/quantum-computing"
      },
      {
        "text": "Recommender Systems (73)",
        "link": "/papers/computer-science/recommender-systems"
      },
      {
        "text": "Reinforcement Learning (81)",
        "link": "/papers/computer-science/reinforcement-learning"
      },
      {
        "text": "Robotics (81)",
        "link": "/papers/computer-science/robotics"
      },
      {
        "text": "Software Engineering (81)",
        "link": "/papers/computer-science/software-engineering"
      },
      {
        "text": "Speech & Audio Processing (73)",
        "link": "/papers/computer-science/speech-audio-processing"
      },
      {
        "text": "Time Series Analysis (73)",
        "link": "/papers/computer-science/time-series-analysis"
      }
    ]
  }
],
      '/papers/economics-management/': [
  {
    "text": "Economics & Management",
    "collapsed": false,
    "items": [
      {
        "text": "Overview",
        "link": "/papers/economics-management/index"
      },
      {
        "text": "Accounting",
        "link": "/papers/economics-management/accounting"
      },
      {
        "text": "Behavioral Economics",
        "link": "/papers/economics-management/behavioral-economics"
      },
      {
        "text": "Digital Economy",
        "link": "/papers/economics-management/digital-economy"
      },
      {
        "text": "Esg Sustainability",
        "link": "/papers/economics-management/esg-sustainability"
      },
      {
        "text": "Finance",
        "link": "/papers/economics-management/finance"
      },
      {
        "text": "Health Economics",
        "link": "/papers/economics-management/health-economics"
      },
      {
        "text": "Human Resources",
        "link": "/papers/economics-management/human-resources"
      },
      {
        "text": "Innovation Entrepreneurship",
        "link": "/papers/economics-management/innovation-entrepreneurship"
      },
      {
        "text": "International Business",
        "link": "/papers/economics-management/international-business"
      },
      {
        "text": "Labor Economics",
        "link": "/papers/economics-management/labor-economics"
      },
      {
        "text": "Macroeconomics",
        "link": "/papers/economics-management/macroeconomics"
      },
      {
        "text": "Marketing",
        "link": "/papers/economics-management/marketing"
      },
      {
        "text": "Microeconomics",
        "link": "/papers/economics-management/microeconomics"
      },
      {
        "text": "Operations Management",
        "link": "/papers/economics-management/operations-management"
      },
      {
        "text": "Public Economics",
        "link": "/papers/economics-management/public-economics"
      },
      {
        "text": "Real Estate Urban Economics",
        "link": "/papers/economics-management/real-estate-urban-economics"
      },
      {
        "text": "Strategic Management",
        "link": "/papers/economics-management/strategic-management"
      },
      {
        "text": "Tourism Hospitality",
        "link": "/papers/economics-management/tourism-hospitality"
      }
    ]
  }
],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/badhope/ScholarLib' },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: `Copyright © 2026 badhope`,
    },
    outline: { level: [2, 3], label: 'On this page' },
    docFooter: {
      prev: 'Previous',
      next: 'Next',
    },
  },
})
