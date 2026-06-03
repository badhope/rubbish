PYTHON ?= python3
NPM    ?= npm

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

.PHONY: dev
dev: ## vitepress dev server
	$(NPM) run docs:dev

.PHONY: build
build: ## build static site
	$(NPM) run docs:build

.PHONY: preview
preview: ## preview built site
	$(NPM) run docs:preview

.PHONY: sidebar
sidebar: ## regenerate docs/.vitepress/config.ts sidebar block
	$(PYTHON) build_sidebar.py

.PHONY: bib
bib: ## regenerate references.bib from per-paper .bib files
	$(PYTHON) scripts/generate_index.py

.PHONY: rss
rss: ## regenerate RSS feed
	$(PYTHON) scripts/generate_rss.py

.PHONY: graph
graph: ## regenerate citation graph data + page
	$(PYTHON) scripts/generate_citation_graph.py

.PHONY: favicon
favicon: ## regenerate favicons + PWA icons
	$(PYTHON) scripts/generate_favicons.py

.PHONY: format
format: ## prettier --write
	$(NPM) run format

.PHONY: lint
lint: ## format:check + vue-tsc
	$(NPM) run format:check
	$(NPM) run type-check

.PHONY: test
test: ## python unittests
	$(PYTHON) -m unittest discover -s tests -p 'test_*.py' -v

.PHONY: validate
validate: ## validate every papers/**/metadata.json
	$(PYTHON) scripts/validate_papers.py

.PHONY: ci
ci: ## what CI runs
	$(NPM) run ci

.PHONY: clean
clean: ## remove build artifacts
	rm -rf docs/.vitepress/dist docs/.vitepress/cache docs/.vitepress/.temp
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
