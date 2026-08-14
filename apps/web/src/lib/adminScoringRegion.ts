/** Default region for Key + Meta / scoring-season admin when the product is EU-only. */
export const ADMIN_SCORING_DEFAULT_REGION = "EU" as const;

export function adminScoringSeasonQuery(region: string = ADMIN_SCORING_DEFAULT_REGION): string {
  return `/api/v1/admin/misc/scoring-season?region=${encodeURIComponent(region)}`;
}
