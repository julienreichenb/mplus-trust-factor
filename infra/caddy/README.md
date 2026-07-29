# Shared edge Caddy for production + test on one VPS.
#
# VPS layout:
#   /opt/mplus/shared/caddy/.env
#   /opt/mplus/prod/.env
#   /opt/mplus/test/.env
#
# Bring up edge first (creates `mplus-proxy` network), then app stacks.
# See doc/operations/production.md
