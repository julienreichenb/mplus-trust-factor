import { describe, expect, it } from "vitest";
import { toBullmqReturnValue } from "./processors.js";

describe("toBullmqReturnValue", () => {
  it("makes BigInt JSON-safe and strips report codes / tokens", () => {
    const result = toBullmqReturnValue({
      character: { blizzardCharacterId: 9007199254740993n },
      score: {
        explanation: {
          access_token: "tok",
          observations: [{ context: { reportCode: "PrivateCodeXYZ", fightId: 1 } }],
        },
      },
    }) as {
      character: { blizzardCharacterId: string };
      score: { explanation: { observations: Array<{ context: { reportCode: string; fightId: number } }> } };
    };

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result.character.blizzardCharacterId).toBe("9007199254740993");
    expect(JSON.stringify(result)).not.toContain("PrivateCodeXYZ");
    expect(JSON.stringify(result)).not.toContain('"tok"');
    expect((result.score.explanation as { access_token: string }).access_token).toBe("[Redacted]");
    expect(result.score.explanation.observations[0]?.context.fightId).toBe(1);
  });
});
