# Integrations guide

Rubbish ships with pluggable integrations for the things every real
deployment needs: transactional email (verification + password reset)
and SSO (OIDC). The framework code is in place; you only need to provide
credentials.

This document covers the three integrations operators most often wire up:

1. **Email** — SMTP relay (Mailgun / SendGrid / SES / Postmark / plain SMTP)
2. **OIDC SSO** — Google / GitHub / Generic OIDC / Keycloak
3. **Bibliographic metadata** — Crossref + arXiv (already enabled by default)

---

## 1. Email (SMTP)

The email backend is selected by `RUBBISH_EMAIL_BACKEND`. Two options:

- `console` (default) — every email body is written to the app log. Fine
  for local dev; never use in production.
- `smtp` — opens an SMTP connection per message. Works with any provider
  that exposes an SMTP relay (which is all of them).

### Multiple sender identities (recommended for free mailboxes)

Free providers (QQ / 126 / 163) throttle per mailbox and occasionally reject
connections outright. Give the app several identities and it will rotate
between them, so one bad mailbox cannot stop verification / reset mail:

```bash
RUBBISH_EMAIL_BACKEND=smtp
RUBBISH_EMAIL_SMTP_ACCOUNTS=[{"host":"smtp.126.com","port":465,"username":"a@126.com","password":"<auth-code>","from_address":"a@126.com","from_name":"Rubbish","use_tls":true,"starttls":false},{"host":"smtp.qq.com","port":465,"username":"b@foxmail.com","password":"<auth-code>","from_address":"b@foxmail.com","from_name":"Rubbish","use_tls":true,"starttls":false}]
```

Behaviour: each send advances a cursor (roughly 50/50), and an identity that
fails `RUBBISH_EMAIL_SMTP_BREAKER_THRESHOLD` times in a row (default 2) is
parked for `RUBBISH_EMAIL_SMTP_BREAKER_COOLDOWN` seconds (default 180) while
the others take over. `RUBBISH_EMAIL_SMTP_ACCOUNTS` takes precedence over the
single `RUBBISH_EMAIL_SMTP_*` fields; leave it empty to keep the single-account
path. `GET /api/admin/maintenance/email-status` probes every identity and
reports address + host only (never the password).

### Recipient throttling

`app/core/mail_guard.py` limits user-triggerable mail per recipient: one send
per `RUBBISH_EMAIL_PER_ADDRESS_COOLDOWN` seconds (default 45) and at most
`RUBBISH_EMAIL_PER_ADDRESS_LIMIT` (default 6) per
`RUBBISH_EMAIL_PER_ADDRESS_WINDOW_MINUTES` (default 30). Over-limit requests
still return 200 (so account existence never leaks) but send nothing. Review
invitations and decision notices are system-triggered and bypass the guard.

### Generic SMTP

```bash
# .env
RUBBISH_EMAIL_BACKEND=smtp
RUBBISH_EMAIL_FROM_ADDRESS=no-reply@yourdomain.com
RUBBISH_EMAIL_FROM_NAME=YourApp
RUBBISH_EMAIL_SMTP_HOST=smtp.yourprovider.com
RUBBISH_EMAIL_SMTP_PORT=587
RUBBISH_EMAIL_SMTP_USERNAME=your-smtp-username
RUBBISH_EMAIL_SMTP_PASSWORD=your-smtp-password
RUBBISH_EMAIL_SMTP_STARTTLS=true
RUBBISH_EMAIL_SMTP_USE_TLS=false
```

### Mailgun

```bash
RUBBISH_EMAIL_SMTP_HOST=smtp.mailgun.org
RUBBISH_EMAIL_SMTP_PORT=587
RUBBISH_EMAIL_SMTP_USERNAME=postmaster@your-domain.mailgun.org
RUBBISH_EMAIL_SMTP_PASSWORD=<mailgun-smtp-password>
RUBBISH_EMAIL_SMTP_STARTTLS=true
```

Get the SMTP credentials from the Mailgun dashboard → Sending → Domains
→ your domain → SMTP.

### SendGrid

```bash
RUBBISH_EMAIL_SMTP_HOST=smtp.sendgrid.net
RUBBISH_EMAIL_SMTP_PORT=587
RUBBISH_EMAIL_SMTP_USERNAME=apikey                # literal string "apikey"
RUBBISH_EMAIL_SMTP_PASSWORD=<your-sendgrid-api-key>
RUBBISH_EMAIL_SMTP_STARTTLS=true
```

### Amazon SES

```bash
RUBBISH_EMAIL_SMTP_HOST=email-smtp.<region>.amazonaws.com
RUBBISH_EMAIL_SMTP_PORT=587
RUBBISH_EMAIL_SMTP_USERNAME=<your-iam-smtp-username>
RUBBISH_EMAIL_SMTP_PASSWORD=<your-iam-smtp-password>
RUBBISH_EMAIL_SMTP_STARTTLS=true
```

To generate the IAM SMTP credentials, see the AWS docs: SES → SMTP
Settings → "SMTP Credentials" (this creates an IAM user with the right
policy — not the same as your regular AWS access key).

### Postmark

```bash
RUBBISH_EMAIL_SMTP_HOST=smtp.postmarkapp.com
RUBBISH_EMAIL_SMTP_PORT=587
RUBBISH_EMAIL_SMTP_USERNAME=<your-server-api-token>
RUBBISH_EMAIL_SMTP_PASSWORD=<your-server-api-token>
RUBBISH_EMAIL_SMTP_STARTTLS=true
```

### Frontend deep-link base URL

The verification + reset emails include a clickable URL pointing at your
frontend SPA, which routes the user through the verify-email / reset-password
pages. Configure the SPA origin so the links work in any email client:

```bash
RUBBISH_FRONTEND_BASE_URL=https://app.yourdomain.com
```

If unset, links fall back to relative paths (`/auth/verify-email?token=...`),
which only work when the user opens the email in the same browser as the
logged-in SPA. Don't rely on this in production.

### Token lifetimes

```bash
RUBBISH_EMAIL_VERIFICATION_EXPIRE_HOURS=24     # default 24
RUBBISH_PASSWORD_RESET_EXPIRE_MINUTES=60       # default 60
```

### Verifying it works

After configuring SMTP, hit the API to trigger an email:

```bash
curl -X POST https://api.yourdomain.com/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "your-real-email@example.com"}'
```

If you don't see the email, check the app logs — every send attempt is
logged with `email_sent_smtp` / `email_smtp_misconfigured_fallback_to_console`
/ `password_reset_email_failed`. The console fallback also fires when
`RUBBISH_EMAIL_SMTP_HOST` or `RUBBISH_EMAIL_FROM_ADDRESS` is empty,
so misconfiguration degrades gracefully rather than 500ing the request.

### Custom sender (Mailgun API / SendGrid API direct)

If you want to skip SMTP and call the provider's HTTP API directly (for
deliverability stats, template IDs, etc.), implement the `EmailSender`
Protocol and wire it in `app.core.email.get_email_sender()`:

```python
# app/core/email.py — add to the bottom
class MailgunApiSender:
    def __init__(self, domain: str, api_key: str, from_addr: str) -> None:
        ...
    async def send(self, *, to: str, subject: str, body: str, html: str | None = None) -> None:
        # httpx POST to https://api.mailgun.net/v3/<domain>/messages
        ...

# In get_email_sender():
if settings.email_backend == "mailgun_api":
    return MailgunApiSender(...)
```

The rest of the app stays unchanged.

---

## 2. OIDC SSO

OIDC is configured via a single set of env vars. The `oidc_provider`
field is the human-readable slug that appears in URLs
(`/api/auth/oidc/google/login`) — pick any string. Provider configuration
lives in the [provider's developer console](https://developers.google.com/identity/openid-connect).

### Common configuration

```bash
RUBBISH_OIDC_ENABLED=true
RUBBISH_OIDC_PROVIDER=google              # slug used in URLs
RUBBISH_OIDC_CLIENT_ID=<your-client-id>
RUBBISH_OIDC_CLIENT_SECRET=<your-client-secret>
RUBBISH_OIDC_REDIRECT_URL=https://app.yourdomain.com/auth/oidc/callback
RUBBISH_OIDC_SCOPES="openid email profile"
```

The callback URL **must match exactly** what you configured in the
provider's console (scheme + host + path). The path part is your SPA's
route — the SPA just receives a redirect and uses the access_token from
the URL fragment. The backend's OIDC callback is at
`GET /api/auth/oidc/{provider}/callback`.

### Google

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth
   client ID → Web application.
2. Add `https://app.yourdomain.com/auth/oidc/callback` to **Authorized
   redirect URIs**.
3. Set these env vars:

```bash
RUBBISH_OIDC_PROVIDER=google
RUBBISH_OIDC_AUTHORIZE_URL=https://accounts.google.com/o/oauth2/v2/auth
RUBBISH_OIDC_TOKEN_URL=https://oauth2.googleapis.com/token
RUBBISH_OIDC_USERINFO_URL=https://openidconnect.googleapis.com/v1/userinfo
```

### GitHub (OAuth 2.0, returns OpenID-shaped userinfo)

GitHub does not implement full OIDC, but Rubbish's flow works with
GitHub's OAuth 2.0 endpoints because we read userinfo from the access
token response.

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Authorization callback URL: `https://app.yourdomain.com/auth/oidc/callback`.
3. Env vars:

```bash
RUBBISH_OIDC_PROVIDER=github
RUBBISH_OIDC_AUTHORIZE_URL=https://github.com/login/oauth/authorize
RUBBISH_OIDC_TOKEN_URL=https://github.com/login/oauth/access_token
RUBBISH_OIDC_USERINFO_URL=https://api.github.com/user
RUBBISH_OIDC_SCOPES="read:user user:email"
```

For GitHub, you'll also need to call `/user/emails` to get the verified
email — extend `_upsert_oidc_user` if you want strict email-verified
handling. The default code trusts `email_verified` from userinfo.

### Generic OIDC (any compliant provider)

```bash
RUBBISH_OIDC_PROVIDER=myidp
RUBBISH_OIDC_AUTHORIZE_URL=https://idp.example.com/authorize
RUBBISH_OIDC_TOKEN_URL=https://idp.example.com/oauth/token
RUBBISH_OIDC_USERINFO_URL=https://idp.example.com/userinfo
```

### Keycloak

```bash
RUBBISH_OIDC_PROVIDER=keycloak
RUBBISH_OIDC_AUTHORIZE_URL=https://keycloak.example.com/realms/myrealm/protocol/openid-connect/auth
RUBBISH_OIDC_TOKEN_URL=https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token
RUBBISH_OIDC_USERINFO_URL=https://keycloak.example.com/realms/myrealm/protocol/openid-connect/userinfo
```

### Multi-provider (future)

Today Rubbish supports one OIDC provider per deployment. Multi-provider
is a config-shape change rather than a code-shape change — the routes
already accept `{provider}` as a path parameter. To add it, change
`Settings.oidc_*` to be provider-keyed (e.g. `oidc_providers` as a JSON
dict) and look up the matching config in `oidc_login` / `oidc_callback`
based on the path parameter.

### Verifying it works

Visit `https://api.yourdomain.com/api/auth/oidc/<provider>/login` in a
browser. You should be redirected to the provider's login screen, then
back to your SPA with `#access_token=...` in the URL fragment. If the
redirect doesn't happen, check the app logs for `oidc_login_success` /
`OIDC provider did not return an access token` / `Invalid or expired
OIDC state`.

### Security notes

- The OIDC `state` parameter is a signed JWT (10-minute TTL) carrying a
  CSRF nonce. The callback verifies it before doing anything.
- The access token is returned in the **URL fragment** (after `#`), not
  the query string. Browsers don't send fragments in `Referer` headers
  or to downstream proxies, so the token doesn't leak the way a query
  parameter would.
- New OIDC users get a random 32-byte bcrypt-hashed password. They cannot
  log in via `/auth/login` (they don't know that password) — but they
  can use `/auth/forgot-password` to set one if they want password access
  alongside OIDC.
- If the provider returns `email_verified=true`, the local user's
  `is_email_verified` is set to True — the email-loop is skipped because
  the provider already verified it.

---

## 3. Bibliographic metadata (Crossref + arXiv)

Already enabled by default in the `ingest` module. No configuration
needed for read-only access.

```bash
# Optional — Crossref politely asks for a mailto in the User-Agent
RUBBISH_CROSSREF_MAILTO=you@example.com
```

Endpoints:

```bash
# Fetch metadata for a DOI
curl -X POST https://api.yourdomain.com/api/ingest/fetch \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"source": "crossref", "id": "10.1000/182"}'

# Fetch metadata for an arXiv ID
curl -X POST https://api.yourdomain.com/api/ingest/fetch \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"source": "arxiv", "id": "2301.00001"}'

# Parse a BibTeX / RIS / CSV file
curl -X POST https://api.yourdomain.com/api/ingest/parse \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"format": "bibtex", "content": "@article{...}"}'
```

Both Crossref and arXiv have rate limits (Crossref: 50 req/s shared pool,
arXiv: 1 req/3s). Rubbish does not retry on rate-limit responses —
the operator should batch imports during off-peak hours.
