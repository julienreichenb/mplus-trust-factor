import { describe, expect, it } from "vitest";
import { selectExactCanonicalRunDigest } from "./select-canonical-run-digest.js";

const PREFERRED = "participant-digest-extractors-v4";

function row(partial: {
  actor?: number;
  revision?: number;
  extractor?: string;
  fightId?: number;
  code?: string;
}) {
  return {
    participantActorId: partial.actor ?? 10,
    extractorVersion: partial.extractor ?? PREFERRED,
    rawRun: {
      reportCode: partial.code ?? "AbC",
      fightId: partial.fightId ?? 11,
      reportRevision: partial.revision ?? 3,
    },
  };
}

describe("selectExactCanonicalRunDigest", () => {
  it("selects the exact reportRevision + actor + preferred extractor", () => {
    const selected = selectExactCanonicalRunDigest(
      [
        row({ revision: 2, extractor: PREFERRED }),
        row({ revision: 3, extractor: PREFERRED }),
        row({ revision: 3, extractor: "older", actor: 10 }),
      ],
      { reportCode: "abc", fightId: 11, reportRevision: 3, participantActorId: 10 },
      PREFERRED,
    );
    expect(selected?.rawRun.reportRevision).toBe(3);
    expect(selected?.extractorVersion).toBe(PREFERRED);
  });

  it("does not cross-wire a different report revision", () => {
    const selected = selectExactCanonicalRunDigest(
      [row({ revision: 9, extractor: PREFERRED })],
      { reportCode: "abc", fightId: 11, reportRevision: 3, participantActorId: 10 },
      PREFERRED,
    );
    expect(selected).toBeNull();
  });

  it("does not pick latest when two acquisition lineages remain after identity filters", () => {
    const a = row({ revision: 3, extractor: PREFERRED });
    const b = {
      ...row({ revision: 3, extractor: PREFERRED }),
      extractorVersion: PREFERRED,
    };
    const selected = selectExactCanonicalRunDigest(
      [a, b],
      { reportCode: "abc", fightId: 11, reportRevision: 3, participantActorId: 10 },
      PREFERRED,
    );
    expect(selected).toBeNull();
  });
});
