import type { Grade } from "../api/types";
import { presentGrade } from "./characterViewModel";

/** Logical ladder: elite → weak, then unrated. */
export const TRUST_GRADES: Grade[] = ["S", "A", "B", "C", "D", "U"];

export const GRADE_RANGES: Record<Grade, string | null> = {
  S: "90–100",
  A: "80–89",
  B: "65–79",
  C: "50–64",
  D: "Below 50",
  U: "Not assigned",
};

export const GRADE_PROFILES: Record<Grade, { title: string; description: string }> = {
  S: {
    title: "Elite trust profile",
    description:
      "Consistently top-tier across dimensions — the kind of player you want when a key cannot afford mistakes.",
  },
  A: {
    title: "Strong trust profile",
    description:
      "Well above average with no major weak spots — a dependable pick for keys at their level.",
  },
  B: {
    title: "Credible trust profile",
    description:
      "Solid overall with room to improve — reasonable when the key matches their progression and the group is balanced.",
  },
  C: {
    title: "Situational trust profile",
    description:
      "Mixed signals or noticeable gaps — may work in the right comp or on a lower key, but worth a closer look before a push.",
  },
  D: {
    title: "Weak trust profile",
    description:
      "Low scores or serious concerns in the underlying data — high deplete risk at level unless you know the player well.",
  },
  U: {
    title: "Unrated",
    description:
      "Not enough reliable public data to assign a fair letter grade — a score may exist, but confidence is too low to treat it as meaningful.",
  },
};

export function trustGradeTip(grade: Grade): string {
  const profile = GRADE_PROFILES[grade];
  const range = GRADE_RANGES[grade];
  if (grade === "U") return `${profile.title} — ${profile.description}`;
  return `${presentGrade(grade).title} (${range}) — ${profile.description}`;
}
