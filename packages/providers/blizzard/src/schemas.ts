import { z } from "zod";

const namedRef = z
  .object({
    id: z.number().optional(),
    name: z.string().optional(),
    slug: z.string().optional(),
    type: z
      .union([
        z.string(),
        z
          .object({
            type: z.string().optional(),
            name: z.string().optional(),
          })
          .passthrough(),
      ])
      .optional(),
  })
  .passthrough();

export const characterProfileSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    realm: z
      .object({
        slug: z.string(),
        name: z.string().optional(),
        id: z.number().optional(),
      })
      .passthrough(),
    character_class: namedRef.optional(),
    active_spec: namedRef.optional(),
    level: z.number().nullish(),
    last_login_timestamp: z.number().nullish(),
    average_item_level: z.number().nullish(),
    equipped_item_level: z.number().nullish(),
    faction: namedRef.optional(),
    _links: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const equipmentSchema = z
  .object({
    character: z
      .object({
        name: z.string().optional(),
        id: z.number().optional(),
        realm: z.object({ slug: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    average_item_level: z.number().nullish(),
    equipped_item_level: z.number().nullish(),
    equipped_items: z
      .array(
        z
          .object({
            item: z.object({ id: z.number() }).passthrough(),
            slot: namedRef.optional(),
            name: z.string().optional(),
            quality: namedRef.optional(),
            level: z.object({ value: z.number().optional() }).passthrough().optional(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
  })
  .passthrough();

export const specializationsSchema = z
  .object({
    specializations: z
      .array(
        z
          .object({
            specialization: namedRef.optional(),
            loadouts: z.array(z.record(z.string(), z.unknown())).optional(),
            talents: z.array(z.record(z.string(), z.unknown())).optional(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    active_specialization: namedRef.optional(),
  })
  .passthrough();

export const mediaSchema = z
  .object({
    assets: z
      .array(
        z.object({
          key: z.string(),
          value: z.string(),
        }),
      )
      .optional()
      .default([]),
  })
  .passthrough();

export const mythicKeystoneProfileIndexSchema = z
  .object({
    current_period: z.record(z.string(), z.unknown()).optional(),
    seasons: z
      .array(z.object({ id: z.number() }).passthrough())
      .optional()
      .default([]),
    character: z
      .object({
        name: z.string().optional(),
        realm: z.object({ slug: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    current_mythic_rating: z
      .object({
        rating: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const mythicRunMemberSchema = z
  .object({
    character: z
      .object({
        name: z.string().optional(),
        realm: z.object({ slug: z.string().optional() }).passthrough().optional(),
        id: z.number().optional(),
      })
      .passthrough()
      .optional(),
    specialization: namedRef.optional(),
    race: namedRef.optional(),
    equipped_item_level: z.number().nullish(),
  })
  .passthrough();

export const mythicBestRunSchema = z
  .object({
    dungeon: namedRef.optional(),
    keystone_level: z.number(),
    duration: z.number(),
    completed_timestamp: z.number(),
    is_completed_within_time: z.boolean().optional(),
    mythic_rating: z
      .object({
        rating: z.number().optional(),
      })
      .passthrough()
      .optional(),
    members: z.array(mythicRunMemberSchema).optional().default([]),
    affixes: z.array(namedRef).optional().default([]),
  })
  .passthrough();

export const mythicKeystoneSeasonProfileSchema = z
  .object({
    season: z.object({ id: z.number() }).passthrough().optional(),
    best_runs: z.array(mythicBestRunSchema).optional().default([]),
    character: z
      .object({
        name: z.string().optional(),
        realm: z.object({ slug: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    current_mythic_rating: z
      .object({
        rating: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const realmSchema = z
  .object({
    id: z.number(),
    slug: z.string(),
    name: z.string(),
    locale: z.string().optional(),
    timezone: z.string().optional(),
    connected_realm: z
      .object({
        href: z.string().optional(),
        id: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const seasonIndexSchema = z
  .object({
    seasons: z.array(z.object({ id: z.number() }).passthrough()).default([]),
    current_season: z.object({ id: z.number() }).passthrough().optional(),
  })
  .passthrough();

export const seasonSchema = z
  .object({
    id: z.number(),
    start_timestamp: z.number().nullish(),
    end_timestamp: z.number().nullish(),
  })
  .passthrough();

export const dungeonIndexSchema = z
  .object({
    dungeons: z.array(z.object({ id: z.number(), name: z.string().optional() }).passthrough()).default([]),
  })
  .passthrough();

export const dungeonSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    map: z.object({ id: z.number().optional(), name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export const itemSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    quality: namedRef.optional(),
    level: z.number().nullish(),
    required_level: z.number().nullish(),
    media: z.object({ id: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();

export const itemMediaSchema = z
  .object({
    assets: z
      .array(z.object({ key: z.string(), value: z.string() }))
      .optional()
      .default([]),
  })
  .passthrough();

export const leaderboardSchema = z
  .object({
    map: z.record(z.string(), z.unknown()).optional(),
    leading_groups: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    period: z.number().optional(),
  })
  .passthrough();

export const blizzardErrorBodySchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    type: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough();

export type CharacterProfilePayload = z.infer<typeof characterProfileSchema>;
export type EquipmentPayload = z.infer<typeof equipmentSchema>;
export type SpecializationsPayload = z.infer<typeof specializationsSchema>;
export type MediaPayload = z.infer<typeof mediaSchema>;
export type MythicKeystoneProfileIndexPayload = z.infer<typeof mythicKeystoneProfileIndexSchema>;
export type MythicKeystoneSeasonProfilePayload = z.infer<typeof mythicKeystoneSeasonProfileSchema>;
export type MythicBestRunPayload = z.infer<typeof mythicBestRunSchema>;
