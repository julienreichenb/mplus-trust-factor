import { z } from "zod";
import { ExternalApiError } from "@mplus/contracts";
import { buildGraphQlFingerprint } from "./fingerprint.js";
import { mapGraphQlErrors, mapHttpStatusToError, wclError } from "./errors.js";
import type { WclTokenManager } from "./token-manager.js";

export interface GraphQlRequestOptions {
  operationName: string;
  query: string;
  variables?: Record<string, unknown>;
  region?: string;
  timeoutMs?: number;
}

export interface GraphQlResponse<T> {
  data: T;
  errors?: Array<{ message: string; extensions?: unknown }>;
  extensions?: { rateLimit?: { cost?: number; limitPerHour?: number; pointsSpentThisHour?: number } };
}

export interface GraphQlClientConfig {
  graphqlUrl: string;
  tokenManager: WclTokenManager;
  defaultTimeoutMs?: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface GraphQlRequestResult<T> {
  response: GraphQlResponse<T>;
  fingerprint: string;
  costUnits: number | null;
  durationMs: number;
}

export class WclGraphQlClient {
  private readonly defaultTimeoutMs: number;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;

  constructor(private readonly config: GraphQlClientConfig) {
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30_000;
    this.logger = config.logger ?? console;
  }

  async request<T>(options: GraphQlRequestOptions): Promise<GraphQlRequestResult<T>> {
    const variables = options.variables ?? {};
    const fingerprint = buildGraphQlFingerprint({
      region: options.region ?? "global",
      operationName: options.operationName,
      variables,
    });

    this.logger.info(
      { operationName: options.operationName, fingerprint },
      "wcl.graphql.request",
    );

    const token = await this.config.tokenManager.getToken();
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(this.config.graphqlUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operationName: options.operationName,
          query: options.query,
          variables,
        }),
        signal: controller.signal,
      });

      const body = (await response.json()) as GraphQlResponse<T>;
      if (!response.ok) {
        throw mapHttpStatusToError(response.status, body);
      }
      if (body.errors?.length) {
        throw mapGraphQlErrors(body.errors);
      }

      const costUnits = body.extensions?.rateLimit?.cost ?? null;
      return {
        response: body,
        fingerprint,
        costUnits,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof ExternalApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw wclError("TIMEOUT", `GraphQL operation ${options.operationName} timed out`);
      }
      throw wclError("NETWORK", `GraphQL operation ${options.operationName} failed`, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Like {@link request} but returns GraphQL errors in the response instead of throwing.
   * HTTP and transport failures still throw.
   */
  async requestPermissive<T>(options: GraphQlRequestOptions): Promise<GraphQlRequestResult<T>> {
    const variables = options.variables ?? {};
    const fingerprint = buildGraphQlFingerprint({
      region: options.region ?? "global",
      operationName: options.operationName,
      variables,
    });

    this.logger.info(
      { operationName: options.operationName, fingerprint, permissive: true },
      "wcl.graphql.request",
    );

    const token = await this.config.tokenManager.getToken();
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(this.config.graphqlUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operationName: options.operationName,
          query: options.query,
          variables,
        }),
        signal: controller.signal,
      });

      const body = (await response.json()) as GraphQlResponse<T>;
      if (!response.ok) {
        throw mapHttpStatusToError(response.status, body);
      }

      const costUnits = body.extensions?.rateLimit?.cost ?? null;
      return {
        response: body,
        fingerprint,
        costUnits,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof ExternalApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw wclError("TIMEOUT", `GraphQL operation ${options.operationName} timed out`);
      }
      throw wclError("NETWORK", `GraphQL operation ${options.operationName} failed`, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const rateLimitDataSchema = z.object({
  rateLimitData: z.object({
    limitPerHour: z.number(),
    pointsSpentThisHour: z.number(),
    /** Live WCL schema field (seconds until reset). */
    pointsResetIn: z.number().optional(),
    /** Legacy fixture alias — prefer pointsResetIn. */
    pointsRemaining: z.number().optional(),
    resetInSeconds: z.number().nullable().optional(),
  }),
});

export const characterResolveSchema = z.object({
  characterData: z.object({
    character: z
      .object({
        id: z.number(),
        canonicalID: z.number(),
        name: z.string(),
        level: z.number().nullable().optional(),
        classID: z.number().nullable().optional(),
        // Live schema: GameFaction object. Legacy fixtures may still send a numeric id.
        faction: z
          .union([
            z.number(),
            z.object({
              id: z.number(),
              name: z.string().nullable().optional(),
            }),
          ])
          .nullable()
          .optional(),
        hidden: z.boolean(),
        server: z.object({
          slug: z.string(),
          region: z.object({ name: z.string() }).optional(),
        }),
      })
      .nullable(),
  }),
});

/** Live API returns zoneRankings as a JSON scalar; fixtures may embed the object directly.
 * Parse-style rows include report+fightID; aggregate/allStars rows do not and are ignored. */
export const zoneRankingParseRowSchema = z.object({
  report: z.object({
    code: z.string(),
    startTime: z.number(),
    endTime: z.number().nullable().optional(),
  }),
  fightID: z.number(),
  encounterID: z.number().nullable().optional(),
  difficulty: z.number().nullable().optional(),
  kill: z.boolean().nullable().optional(),
  duration: z.number().nullable().optional(),
  bracket: z.number().nullable().optional(),
  score: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  amount: z.number().nullable().optional(),
  spec: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  startTime: z.number().nullable().optional(),
});

export const zoneRankingsPayloadSchema = z
  .object({
    metric: z.string().nullable().optional(),
    difficulty: z.number().nullable().optional(),
    rankPercent: z.number().nullable().optional(),
    medianPercent: z.number().nullable().optional(),
    totalParses: z.number().nullable().optional(),
    partition: z.number().nullable().optional(),
    bestPerformanceAverage: z.number().nullable().optional(),
    medianPerformanceAverage: z.number().nullable().optional(),
    zone: z
      .union([
        z.number(),
        z.object({ id: z.number(), name: z.string().nullable().optional() }),
      ])
      .nullable()
      .optional(),
    // Accept both parse-style and aggregate ranking rows; mapping filters appropriately.
    rankings: z.array(z.unknown()).optional().default([]),
  })
  .passthrough()
  .nullable();

export const zoneRankingsSchema = z.object({
  characterData: z.object({
    character: z
      .object({
        zoneRankings: z.preprocess((value) => {
          if (typeof value === "string") {
            try {
              return JSON.parse(value) as unknown;
            } catch {
              return value;
            }
          }
          return value;
        }, zoneRankingsPayloadSchema),
      })
      .nullable(),
  }),
});

export const recentReportsSchema = z.object({
  characterData: z.object({
    character: z
      .object({
        recentReports: z
          .object({
            data: z
              .array(
                z.object({
                  code: z.string(),
                  title: z.string().nullable().optional(),
                  startTime: z.number(),
                  endTime: z.number().nullable().optional(),
                  visibility: z.string().nullable().optional(),
                  zone: z.object({ id: z.number(), name: z.string().nullable().optional() }).nullable().optional(),
                }),
              )
              .default([]),
            total: z.number().nullable().optional(),
            has_more_pages: z.boolean().nullable().optional(),
          })
          .nullable(),
      })
      .nullable(),
  }),
});

export const reportFightSchema = z.object({
  reportData: z.object({
    report: z
      .object({
        code: z.string(),
        title: z.string(),
        revision: z.number(),
        startTime: z.number(),
        endTime: z.number(),
        visibility: z.string(),
        zone: z.object({ id: z.number(), name: z.string().nullable().optional() }).nullable().optional(),
        fights: z.array(
          z.object({
            id: z.coerce.number(),
            encounterID: z.coerce.number().nullable().optional(),
            name: z.string().nullable().optional(),
            difficulty: z.coerce.number().nullable().optional(),
            kill: z.boolean().nullable().optional(),
            startTime: z.coerce.number(),
            endTime: z.coerce.number(),
            keystoneLevel: z.coerce.number().nullable().optional(),
            // +1/+2/+3 when the key was timed; 0 when completed depleted; null when unknown.
            keystoneBonus: z.coerce.number().nullable().optional(),
            // Live schema: actor ID ints. Legacy fixtures may still embed player objects.
            friendlyPlayers: z
              .array(
                z.union([
                  z.coerce.number(),
                  z.object({
                    id: z.coerce.number(),
                    name: z.string(),
                    server: z.string(),
                    type: z.string(),
                    icon: z.string().nullable().optional(),
                  }),
                ]),
              )
              .nullable()
              .optional(),
          }),
        ),
        masterData: z
          .object({
            actors: z
              .array(
                z.object({
                  id: z.coerce.number(),
                  name: z.string(),
                  type: z.string(),
                  subType: z.string().nullable().optional(),
                  server: z.string().nullable().optional(),
                  /** Report-local owner actor ID when this actor is a pet. */
                  petOwner: z.coerce.number().nullable().optional(),
                }),
              )
              .default([]),
            abilities: z
              .array(
                z.object({
                  // Live WCL often serializes ability IDs as strings in JSON scalars.
                  gameID: z.coerce.number(),
                  type: z.coerce.number().nullable().optional(),
                }),
              )
              .default([]),
          })
          .nullable()
          .optional(),
      })
      .nullable(),
  }),
});

export const eventsPageSchema = z.object({
  reportData: z.object({
    report: z
      .object({
        events: z.object({
          data: z.array(z.record(z.unknown())).default([]),
          nextPageTimestamp: z.number().nullable().optional(),
        }),
      })
      .nullable(),
  }),
});

export function parseWithSchema<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw wclError("INVALID_RESPONSE", `Invalid WCL response shape for ${label}`, parsed.error.flatten());
  }
  return parsed.data;
}
