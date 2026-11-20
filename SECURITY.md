# Security policy

**English · [简体中文](SECURITY.zh-CN.md)**

## Supported version

Only `main` receives security fixes. Tags and archived branches are not patched.

## Reporting

Do not open a public issue for a vulnerability.

- Open a private draft in the repository's **Security Advisories** tab, or
- email `info@rubbishasci.cn` with the subject `Rubbish security`.

Include the affected endpoint or file, reproduction steps, impact, and any suggested fix. Do not include real user data or live credentials. You will get an acknowledgement within 3 working days and a status update within 10 days.

## Scope

In scope:

- authentication, session handling, password reset, TOTP, and OIDC;
- tenant isolation and PostgreSQL row-level security;
- access control on archive drafts, community moderation, and admin routes;
- upload handling, path traversal, and content-type confusion;
- stored/reflected XSS, CSRF, SSRF, and SQL injection;
- privacy leaks in exports, RSS, sitemap, logs, or error pages.

Out of scope:

- denial of service caused by unrealistic traffic volumes;
- missing headers on a local development server;
- reports that require a compromised administrator account;
- social engineering of maintainers.

## Built-in protections

- bcrypt password hashing and short-lived access tokens;
- refresh-token rotation with reuse detection;
- optional TOTP two-factor authentication;
- PostgreSQL row-level security with `FORCE ROW LEVEL SECURITY`;
- per-IP and per-address rate limits;
- upload limits, filename normalization, and content-type checks;
- audit logs for administrative actions;
- encrypted production backups; the key is never stored in the repository.

## Disclosure

We coordinate a fix and a release before publishing details. Credit is given unless the reporter prefers to stay anonymous.
