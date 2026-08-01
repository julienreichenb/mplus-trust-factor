/**
 * Mutation / side-effect guard for Phase 2 harness.
 * Proves read-only evaluation: no ScoreSnapshot / CharacterRedFlag / authenticity writes.
 */

export interface MutationGuardCounters {
  evidenceReads: number;
  providerCalls: number;
  scoreSnapshotWrites: number;
  characterRedFlagWrites: number;
  authenticityInputWrites: number;
  authenticityOutputWrites: number;
  databaseWrites: number;
}

export interface MutationGuard {
  counters: MutationGuardCounters;
  recordEvidenceRead(memberId: string): void;
  recordProviderCall(): void;
  recordScoreSnapshotWrite(): void;
  recordCharacterRedFlagWrite(): void;
  recordAuthenticityInputWrite(): void;
  recordAuthenticityOutputWrite(): void;
  recordDatabaseWrite(): void;
  assertReadOnlyContext(): void;
  assertNoWrites(): void;
  assertNoProviderCalls(): void;
}

export function createMutationGuard(): MutationGuard {
  const counters: MutationGuardCounters = {
    evidenceReads: 0,
    providerCalls: 0,
    scoreSnapshotWrites: 0,
    characterRedFlagWrites: 0,
    authenticityInputWrites: 0,
    authenticityOutputWrites: 0,
    databaseWrites: 0,
  };

  return {
    counters,
    recordEvidenceRead() {
      counters.evidenceReads += 1;
    },
    recordProviderCall() {
      counters.providerCalls += 1;
    },
    recordScoreSnapshotWrite() {
      counters.scoreSnapshotWrites += 1;
    },
    recordCharacterRedFlagWrite() {
      counters.characterRedFlagWrites += 1;
    },
    recordAuthenticityInputWrite() {
      counters.authenticityInputWrites += 1;
    },
    recordAuthenticityOutputWrite() {
      counters.authenticityOutputWrites += 1;
    },
    recordDatabaseWrite() {
      counters.databaseWrites += 1;
    },
    assertReadOnlyContext() {
      // Intentionally empty — presence documents the contract for tests.
    },
    assertNoWrites() {
      if (counters.scoreSnapshotWrites > 0) {
        throw new Error("ScoreSnapshot write attempted during shadow backtest");
      }
      if (counters.characterRedFlagWrites > 0) {
        throw new Error("CharacterRedFlag write attempted during shadow backtest");
      }
      if (counters.authenticityInputWrites > 0) {
        throw new Error("AuthenticityFeatureInput write attempted during shadow backtest");
      }
      if (counters.authenticityOutputWrites > 0) {
        throw new Error("Authenticity output write attempted during shadow backtest");
      }
      if (counters.databaseWrites > 0) {
        throw new Error("Database write attempted during shadow backtest");
      }
    },
    assertNoProviderCalls() {
      if (counters.providerCalls > 0) {
        throw new Error("Provider adapter invoked during shadow backtest");
      }
    },
  };
}

/**
 * Wrap a Prisma-like client so any mutating call during harness execution fails.
 * Seed/setup must use the unwrapped client.
 */
export function createReadOnlyPrismaProxy<T extends object>(
  client: T,
  guard: MutationGuard,
): T {
  const mutating = new Set([
    "create",
    "createMany",
    "update",
    "updateMany",
    "upsert",
    "delete",
    "deleteMany",
    "executeRaw",
    "executeRawUnsafe",
    "$executeRaw",
    "$executeRawUnsafe",
    "$transaction",
  ]);

  const wrap = (target: object): object =>
    new Proxy(target, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);
        if (typeof prop === "string" && mutating.has(prop)) {
          return (..._args: unknown[]) => {
            guard.recordDatabaseWrite();
            throw new Error(`Read-only Prisma proxy blocked mutating call: ${prop}`);
          };
        }
        if (value && typeof value === "object") {
          return wrap(value as object);
        }
        if (typeof value === "function") {
          return value.bind(obj);
        }
        return value;
      },
    });

  return wrap(client) as T;
}
