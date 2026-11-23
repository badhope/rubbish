# Mainland CN IP ranges

`mainland_cn_ip_ranges.txt` is a combined IPv4 + IPv6 snapshot of the public
CN zones published by ipdeny.com, fetched on 2026-11-23:

- https://www.ipdeny.com/ipblocks/data/countries/cn.zone
- https://www.ipdeny.com/ipv6/ipaddresses/blocks/cn.zone

It is used by `app/core/mainland_gate.py` to decide whether a request should
see the password gate. The data is a routing/geolocation aid, not a legal
boundary; refresh it periodically. Keep the file in sync when changing the
gate deployment.
