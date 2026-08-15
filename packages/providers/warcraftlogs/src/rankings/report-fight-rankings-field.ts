/**
 * Production Report.rankings field matching the WCL UI Damage Done Key % table.
 * Must stay in lockstep with WCL_FIGHT_RANKING_SEMANTIC_V2_UI_KEY_PERCENT.
 */
import { WCL_FIGHT_RANKING_SEMANTIC_V2_UI_KEY_PERCENT as S } from "@mplus/contracts";

export const REPORT_FIGHT_RANKINGS_FIELD = `rankings(fightIDs: $fightIDs, compare: ${S.compare}, playerMetric: ${S.playerMetric}, timeframe: ${S.timeframe})`;
