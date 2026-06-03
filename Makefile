# ScholarLib — Developer Commands
#
# Common recipes to keep the workflow consistent across machines.
# Run `make help` to see all available targets.

SHELL := /bin/bash
PYTHON ?= python3
NPM    ?= npm
NPX    ?= npx

# Detect OS for cross-platform compat
ifeq ($(OS),Windows_NT)
	RM = rmdir /S /Q
	PYTHON = python
else
	RM = rm -rf
endif

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help message
	@echo "ScholarLib — available targets:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────

.PHONY: init
init: ## Install all dependencies (Node + Python)
	$(NPM) install
	@echo ""
	@echo "Optional Python packages for full functionality:"
	@echo "  pip install requests beautifulsoup4 anthropic"
	@echo ""
	@echo "✓ Initialization complete."

# ── Docs (VitePress) ──────────────────────────────────────────────────────

.PHONY: dev
dev: ## Start VitePress dev server with hot-reload
	$(NPM) run docs:dev

.PHONY: build
build: ## Build production site to docs/.vitepress/dist (with a11y post-process)
	$(NPM) run docs:build

.PHONY: build-no-a11y
build-no-a11y: ## Build site without a11y post-processing
	$(NPM) run docs:build:no-a11y

.PHONY: preview
preview: ## Preview the production build locally
	$(NPM) run docs:preview

.PHONY: sidebar
sidebar: ## Regenerate sidebar block in docs/.vitepress/config.ts
	$(PYTHON) build_sidebar.py

# ── Scripts ───────────────────────────────────────────────────────────────

.PHONY: bib
bib: ## Generate consolidated references.bib from all .bib files
	$(PYTHON) scripts/generate_index.py

.PHONY: graph
graph: ## Build citation graph data + page
	$(PYTHON) scripts/generate_citation_graph.py

.PHONY: rss
rss: ## Generate RSS feed
	$(PYTHON) scripts/generate_rss.py

.PHONY: favicon
favicon: ## Generate favicons from og-image.svg
	$(PYTHON) scripts/generate_favicons.py

# ── Quality ───────────────────────────────────────────────────────────────

.PHONY: test
test: ## Run Python unit tests
	$(PYTHON) -m unittest discover -s tests -p 'test_*.py' -v

.PHONY: lint
lint: format-check type-check ## Run all linters (format check + TypeScript)

.PHONY: format
format: ## Auto-format all files with Prettier
	$(NPM) run format

.PHONY: format-check
format-check: ## Check formatting without changes
	$(NPM) run format:check

.PHONY: type-check
type-check: ## Run TypeScript type checker
	@if [ -d node_modules/.bin ]; then \
		$(NPX) --yes vue-tsc --noEmit -p tsconfig.json; \
	else \
		echo "Run 'make init' first."; \
	fi

.PHONY: validate
validate: ## Validate paper metadata.json files
	$(PYTHON) scripts/validate_papers.py

# ── Clean ─────────────────────────────────────────────────────────────────

.PHONY: clean
clean: ## Remove all build artifacts
	$(RM) docs/.vitepress/dist
	$(RM) docs/.vitepress/cache
	$(RM) docs/.vitepress/.temp
	$(RM) references.bib
	$(RM) __pycache__
	$(RM) tests/__pycache__
	$(RM) scripts/__pycache__
	$(RM) .pytest_cache
	$(RM) .ruff_cache
	$(RM) .mypy_cache
	@find . -type d -name '__pycache__' -exec $(RM) {} + 2>/dev/null || true

.PHONY: deepclean
deepclean: clean ## Remove everything including node_modules
	$(RM) node_modules
	$(RM) package-lock.json
	@echo "⚠ Run 'make init' to re-install."

# ── Aggregate ─────────────────────────────────────────────────────────────

.PHONY: all
all: clean test build validate ## Clean → test → build → validate

.PHONY: ci
ci: lint test build ## Simulate CI pipeline locally

# ── Git ───────────────────────────────────────────────────────────────────

.PHONY: status
status: ## Show git status
	git status --short

.PHONY: log
log: ## Show last 10 commits
	git log --oneline -10
