# Paper Template

Use this template when submitting a new paper to ScholarLib-EM.

## Required Files

1. **`paper-name.pdf`** — Full-text PDF of the paper
2. **`paper-name.bib`** — BibTeX citation entry (see `paper-template.bib`)
3. **`metadata.json`** — Structured metadata (see `metadata.json`)

## Steps

1. Copy this entire folder to `papers/{year}/{category}/`
2. Rename the folder and files to match the paper (use `kebab-case`)
3. Fill in the `.bib` and `metadata.json` files with the paper's information
4. Add the PDF file
5. Submit a Pull Request

## Example

If submitting a paper called "Market Frictions in Crypto Trading" published in 2024 under Finance:

```
papers/2024/finance/market-frictions-in-crypto/
├── market-frictions-in-crypto.pdf
├── market-frictions-in-crypto.bib
└── metadata.json
```
