# Security Policy

## Supported Versions

The latest version of `main` branch receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it
privately by emailing the maintainer or opening a **private** security advisory
on GitHub:

👉 https://github.com/badhope/ScholarLib/security/advisories/new

**Please do not open a public issue for security vulnerabilities.**

You can expect:

- An acknowledgment within 72 hours
- A status update within 7 days
- A fix or mitigation plan as soon as the severity is assessed

## Scope

This repository contains:

- A static documentation site (VitePress)
- Paper metadata in YAML/JSON format
- Optional PDF copies of open-access papers
- GitHub Actions workflows

The site itself has minimal attack surface — it is static HTML/CSS/JS served
from GitHub Pages. The main concerns are:

- **Malicious content in paper metadata** (XSS via injected HTML)
- **Compromised dependencies** (handled by Dependabot)
- **Token / secret leakage** in paper files

## Best Practices for Contributors

- Never commit secrets, API keys, or credentials
- Sanitize any user-submitted content
- Keep dependencies up to date (Dependabot will help)
- Review Actions workflows for third-party action versions
