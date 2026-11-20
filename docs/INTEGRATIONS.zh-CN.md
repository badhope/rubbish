# 外部集成

**[English](integrations.md) · 简体中文**

Rubbish 不依赖外部服务也能运行。只有两类集成是可选的：事务邮件和 OIDC 单点登录。

## 邮件

默认后端把邮件写进应用日志。本地开发、或者由管理员统一管理账号的部署，这样就够了。

要真正发信，配置 SMTP：

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

465 端口配 `USE_TLS=true`，587 端口配 `STARTTLS=true`。发件地址必须属于 SMTP 账号，否则多数服务商会拒发。

`RUBBISH_EMAIL_SMTP_ACCOUNTS` 可以填 JSON 账号数组。第一个健康账号负责全部发信；连续失败后才切到下一个。`GET /api/admin/maintenance/email-status` 只返回主机和地址，不返回密码。

单地址限流在 `app/core/mail_guard.py`，防止验证码或找回密码邮件被反复触发。

## OIDC

OIDC 默认关闭。启用方式：

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

Google、GitHub 和通用 OIDC 服务都用同一组字段。除非服务商不支持，否则保持 PKCE 开启。

## 没有接入的东西

Rubbish 不调用 Crossref、arXiv、ORCID 或其他文献服务。档案元数据在站内录入和保存，离线也能用，也不会把账号数据发给第三方。
