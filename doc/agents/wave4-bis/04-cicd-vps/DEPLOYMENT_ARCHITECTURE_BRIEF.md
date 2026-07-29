# Deployment Architecture Brief

## Target topology

```text
Internet
  |
Reverse proxy / TLS
  |--------------------|
  |                    |
Web                  API
                       |
                    PostgreSQL
                       |
                     Worker
                       |
                      Redis
```

PostgreSQL is authoritative. Redis accelerates queues/cache and may be rebuilt.

## Deployment rules

- immutable commit-SHA images;
- migrate before worker/API rollout;
- never reset the database;
- health-check every service;
- back up before risky migrations;
- roll back application images on failed health checks;
- keep database and Redis off the public network.

## VPS sizing

The agent should provide assumptions and tunable recommendations rather than one hardcoded size.

Sizing must consider public traffic, worker concurrency, WCL batches, PostgreSQL growth, raw artifact retention and Docker overhead.
