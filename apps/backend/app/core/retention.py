"""Data-retention constants and helpers.

Values match the public privacy policy so the policy and the code
cannot drift apart silently. Operators run the cleanup jobs from
their scheduler of choice; we expose ``retention_cutoff`` so a
caller can compute the bound without hard-coding the policy in
multiple places.

Retention policy (mirrors ``/api/privacy``):

- Account PII: held until the user requests deletion; soft-deleted
  accounts are anonymised in place and hard-deleted after
  ``USER_DELETION_GRACE_DAYS`` days.
- Audit logs: ``AUDIT_LOG_RETENTION_DAYS`` days.
- Backups: 90 days (operational concern, not enforced in code).
"""

from __future__ import annotations

# 30-day window between soft delete and hard delete of the user row.
# Match the value advertised in /api/privacy.
USER_DELETION_GRACE_DAYS: int = 30

# Audit logs are retained for one year. After this window the row
# is purged by the operational cleanup job; the policy is exported
# via /api/privacy and reflected in any data-export request.
AUDIT_LOG_RETENTION_DAYS: int = 365


__all__ = [
    "AUDIT_LOG_RETENTION_DAYS",
    "USER_DELETION_GRACE_DAYS",
]
