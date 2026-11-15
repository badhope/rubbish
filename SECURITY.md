# Security Policy

## Supported Versions

Only the latest release on `main` receives security updates. Older tags are
not patched in-place; please upgrade.

| Branch  | Supported |
|---------|-----------|
| `main`  | ✅ Active  |
| older   | ❌ No      |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security reports.** Use one of the
private channels below:

1. **GitHub Security Advisories** (preferred) — open a private draft on the
   GitHub Security tab. The repo owner is automatically CC'd and the report
   stays private until disclosure is agreed.
2. **Email** — reach the maintainer via the address listed on the
   GitHub profile. (Avoid pasting secrets in the issue title.)

Please include:

- Description of the vulnerability + attack scenario
- Steps to reproduce (PoC script / curl trace preferred)
- Potential impact (auth bypass? RCE? data exfiltration?)
- Suggested fix (if you have one)

You should receive a first response within **72 hours**. Fixes are
typically shipped within **30 days** for high-severity issues, coordinated
with the reporter for responsible disclosure.

## Built-in Security Layers

### Authentication & session

| Layer | Implementation |
|-------|---------------|
| Password hashing | bcrypt with per-row salt, cost factor 12 |
| Access tokens | JWT (HS256) — short-lived, signed with the **current** key from the rotation chain |
| Refresh tokens | JWT in `httpOnly`, `Secure`, `SameSite=strict` cookie; version counter (`token_version`) on the user model lets admins force a global re-login |
| 2FA | TOTP (RFC 6238) per-user secret encrypted at rest with Fernet; 10 single-use backup codes hashed with SHA-256 |
| OIDC SSO | PKCE required by default; `state` parameter is a short-lived JWT (defence against CSRF on the callback) |
| Rate-limit | Sliding window per IP + route, pluggable store (in-memory default, Redis backend for multi-node) |

### Authorisation

- App-layer query filter by `tenant_id` + PostgreSQL RLS as a second
  enforcement layer.
- `get_current_user` rejects `is_active=False` users with **401** before
  leaking any account state.
- Admin-only endpoints (`/api/admin/*`) check the `is_admin` flag after
  token validation.
- GDPR endpoints (`/api/users/me/export|delete|restore`) use a
  *soft-delete-aware* dependency so users in the 30-day grace window
  can still call `restore`.

### Secrets & rotation

- All secrets live in environment variables — never in the repo
  (`.gitleaks.toml` blocks them).
- JWT secret rotation is online: `POST /api/admin/reload-secret-keys`
  rebuilds the active key list without restarting the process.
  New tokens are signed with the newest key; old tokens remain
  verifiable during the rotation window.
- On user-initiated account deletion, `token_version` is incremented,
  immediately invalidating every active session.

### Transport & headers

- `SecurityHeadersMiddleware` ships: `CSP`, `HSTS`,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`.
- CORS allowlist, `TrustedProxies` for `X-Forwarded-For`.
- Cookies are `SameSite=strict`; `Secure` is auto-enabled in production.

### Audit & monitoring

- Every privileged admin action is recorded per tenant in the audit
  log table.
- GitHub Actions run **gitleaks** + **CodeQL** + **pip-audit** on every
  push and PR.
- Dependabot opens weekly PRs for vulnerable dependencies; patch &
  minor updates are auto-squash-merged.

## Local Security Tooling

```bash
# Backend
cd apps/backend
uv run bandit -r app                 # static security lint
uv run pip-audit                     # PyPI dependency CVE scan
uv run ruff check .                  # style + bug categories
uv run mypy app                      # type-based bug detection
uv run pytest                        # includes security regression tests

# Frontend
cd apps/frontend
npm run lint
npm run typecheck
npm audit                            # npm dependency CVE scan
```

## Incident Response

If a secret or vulnerability is exposed:

1. **Rotate immediately** (treat the leaked value as public).
2. For JWT keys: update `RUBBISH_SECRET_KEY` and
   `RUBBISH_PREVIOUS_SECRET_KEYS` in every environment, then
   call `POST /api/admin/reload-secret-keys`.
3. **Audit access** via `GET /api/audit-logs` (admin).
4. **Notify** through a GitHub Security Advisory.
5. **Force re-auth** by bumping `token_version` on affected users via
   `PATCH /api/admin/users/{id}`.

## Disclaimer

This software is provided "as is" without warranty. The maintainer is
not liable for damages arising from its use.
