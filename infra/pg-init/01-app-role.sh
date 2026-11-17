#!/bin/sh
# postgres initdb 阶段执行（docker-entrypoint-initdb.d），身份为 POSTGRES_USER。
#
# superuser 绕过 RLS（FORCE ROW LEVEL SECURITY 也无效），所以应用必须用
# 非 superuser 角色连库，租户隔离才真正生效。本脚本在首次初始化时创建
# rubbish_app 并授权；后续迁移由 POSTGRES_USER 执行，ALTER DEFAULT
# PRIVILEGES 保证新建表/序列自动授权给 rubbish_app。
#
# RUBBISH_APP_DB_PASSWORD 未设置时跳过（应用回退 superuser 连接，
# 生产启动日志会打 rls_bypassed_by_superuser 告警）。已有数据卷的集群
# initdb 不会再跑：用 apps/backend/migrations-sql/20261117_rls_app_role.sql
# 手工补角色，见 DEPLOY.md。
set -e

if [ -z "${RUBBISH_APP_DB_PASSWORD:-}" ]; then
    echo "notice: RUBBISH_APP_DB_PASSWORD unset - skipping rubbish_app role creation."
    echo "notice: app will connect as superuser; RLS will NOT be enforced."
    echo "notice: see DEPLOY.md and migrations-sql/20261117_rls_app_role.sql."
    exit 0
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v app_password="$RUBBISH_APP_DB_PASSWORD" \
    -v db="$POSTGRES_DB" \
    -v db_owner="$POSTGRES_USER" <<'EOSQL'
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rubbish_app') THEN
        CREATE ROLE rubbish_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END
$$;

ALTER ROLE rubbish_app PASSWORD :'app_password';

GRANT CONNECT ON DATABASE :"db" TO rubbish_app;
GRANT USAGE ON SCHEMA public TO rubbish_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rubbish_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rubbish_app;

ALTER DEFAULT PRIVILEGES FOR ROLE :"db_owner" IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rubbish_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"db_owner" IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO rubbish_app;
EOSQL

echo "rubbish_app role ready - set RUBBISH_DB_APP_USER=rubbish_app so the app uses it."