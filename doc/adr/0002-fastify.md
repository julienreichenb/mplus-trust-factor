# ADR 0002 — Fastify for the HTTP API

## Status

Accepted

## Context

The API needs schema-first validation, OpenAPI generation, low overhead on a small VPS, and structured logging.

## Decision

Use Fastify 5 with `@fastify/swagger` for OpenAPI and Pino for logs.

## Consequences

- Route schemas feed OpenAPI documents.
- Fastify inject supports lightweight health tests without a listening port.
- Agent 5 extends routes without replacing the framework.
