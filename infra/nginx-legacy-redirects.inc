# 旧站公开链接重定向：只做 301。审稿台与编辑台已恢复，相关路径不再重定向。
# 这些路径在旧版本存在，仍有外部链接和搜索流量；统一送到现在的社区、档案或指南。
location = /dashboard { return 301 /me; }
location = /papers { return 301 /catalog?track=paper; }
location = /fun { return 301 /catalog?track=essay; }
location = /archive { return 301 /catalog; }
location ^~ /archive/ { return 301 /catalog; }
location = /rules { return 301 /guide?tab=policies; }
location = /appeals { return 301 /guide?tab=policies; }
location = /tools { return 301 /guide; }
location = /authors { return 301 /catalog; }
location = /journal-metrics { return 301 /about; }
location = /shop { return 301 /me?tab=points; }
location = /feedback { return 301 /forum?view=feedback; }
location = /notifications { return 301 /me; }
location = /settings { return 301 /me?tab=settings; }
location = /profile { return 301 /me; }
location = /bookmarks { return 301 /me?tab=library; }
location = /history { return 301 /me?tab=library; }
location ~ ^/claim/([0-9]+)/?$ { return 301 /catalog/$1; }
