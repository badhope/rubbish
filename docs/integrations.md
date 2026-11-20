# Integrations

**English · [简体中文](INTEGRATIONS.zh-CN.md)**

Rubbish runs without external services. Two integrations are optional: transactional email and OIDC single sign-on.

## Email

The default backend writes messages to the application log. That is enough for local development and for a deployment where accounts are managed by an administrator.

For real mail, configure SMTP:

```env
RUBBISH_EMAIL_BACKEND=smtp
RUBBISH_EMAIL_OUTBOUND_ENABLED=true
RUBBISH_EMAIL_FROM_ADDRESS=no-reply@example.com
RUBBISH_EMAIL_FROM_NAME=Rubbish
RUBBISH_EMAIL_SMTP_HOST=smtp.example.com
RUBBISH_EMAIL_SMTP_PORT=587
RUBBISH_EMAIL_SMTP_USERNAME=...
RUBBISH_EMAIL_SMTP_PASSWORD=...
RUBBISH_EMAIL_SMTP_USE_TLS=false
RUBBISH_EMAIL_SMTP_STARTTLS=true
```

Use port 465 with `USE_TLS=true`, or port 587 with `STARTTLS=true`. The sender address must belong to the SMTP account, otherwise most providers reject the message.

`RUBBISH_EMAIL_SMTP_ACCOUNTS` accepts a JSON array of accounts. The first healthy account sends everything; the next one takes over only after the first fails repeatedly. `GET /api/admin/maintenance/email-status` reports host and address, never the password.

Recipient throttling lives in `app/core/mail_guard.py`. It prevents a single address from being flooded by verification or reset requests.

## OIDC

OIDC is disabled by default. To enable a provider:

```env
RUBBISH_OIDC_ENABLED=true
RUBBISH_OIDC_PROVIDER=keycloak
RUBBISH_OIDC_CLIENT_ID=...
RUBBISH_OIDC_CLIENT_SECRET=...
RUBBISH_OIDC_AUTHORIZE_URL=https://sso.example.com/auth
RUBBISH_OIDC_TOKEN_URL=https://sso.example.com/token
RUBBISH_OIDC_USERINFO_URL=https://sso.example.com/userinfo
RUBBISH_OIDC_REDIRECT_URL=https://rubbish.example.com/auth/oidc/callback
RUBBISH_OIDC_SCOPES=openid email profile
```

Google, GitHub, and generic OIDC providers use the same fields. Keep PKCE enabled unless the provider does not support it.

## What is not included

Rubbish does not call Crossref, arXiv, ORCID, or any other bibliographic service. Archive metadata is entered and stored locally. This keeps the app usable offline and avoids sending account data to third parties.
