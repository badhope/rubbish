-- ============================================================================
-- RLS 应用角色（非 superuser）
-- 日期：2026-11-17
--
-- 说明：
--   * superuser 绕过 RLS（FORCE ROW LEVEL SECURITY 也无效）。默认 compose
--     以 POSTGRES_USER（superuser）连库，租户隔离实际不生效；本脚本创建
--     非 superuser 应用角色 rubbish_app 并授权，应用改用它连库。
--   * 幂等：角色存在则只刷新密码与授权，可重复执行。
--   * 用法（superuser 执行）：
--       psql -d rubbish -v app_password='<强随机密码>' -f 20261117_rls_app_role.sql
--     然后把 RUBBISH_DATABASE_URL 的用户/密码换成 rubbish_app / 该密码。
--   * 新集群可由 infra/pg-init/01-app-role.sh 在 initdb 阶段自动完成等价操作。
--   * ALTER DEFAULT PRIVILEGES 保证后续迁移（superuser 执行）新建的表/序列
--     自动授权给 rubbish_app，无需每次补 GRANT。
-- ============================================================================

SELECT current_database() AS db \gset
-- 默认权限要挂在“执行迁移的角色”上：迁移由 superuser（POSTGRES_USER）执行，
-- 新建表归它所有，故 FOR ROLE 取 current_user。
SELECT current_user AS db_owner \gset

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