/**
 * Production vs test dependency wiring for Scoring V2 canary operator commands.
 */
import type { AppEnv } from "@mplus/config";
import type { Character } from "@mplus/database";
import type { CharacterIdentityInput } from "@mplus/contracts";
import { createWorkerContainer, type WorkerContainer } from "../../../container.js";
import { createProductionRunOrchestrationPorts } from "../run-orchestration/production-ports.js";
import type { RunOrchestrationPorts } from "../run-orchestration/orchestrator.js";
import type { MemoryOrchestrationPorts } from "../run-orchestration/memory-ports.js";

export type CanaryRepositoryMode = "PRODUCTION" | "MEMORY" | "FIXTURE";

export const CANARY_SENTINEL_CHARACTER_ID =
  "00000000-0000-4000-8000-000000000001";

export class CharacterNotFoundError extends Error {
  readonly code = "CHARACTER_NOT_FOUND" as const;
  readonly identity: CharacterIdentityInput;

  constructor(identity: CharacterIdentityInput) {
    super(
      `CHARACTER_NOT_FOUND: ${identity.region}/${identity.realmSlug}/${identity.name}`,
    );
    this.name = "CharacterNotFoundError";
    this.identity = identity;
  }
}

export interface CanaryCharacterResolution {
  characterResolutionSource: "postgresql.findByIdentity" | "test.injected";
  characterId: string;
  characterCanonicalIdentity: {
    region: string;
    realmSlug: string;
    name: string;
  };
  repositoryMode: CanaryRepositoryMode;
}

export interface ProductionCanaryDependencies {
  repositoryMode: "PRODUCTION";
  container: WorkerContainer;
  ports: RunOrchestrationPorts;
  character: Character;
  characterResolution: CanaryCharacterResolution;
}

export interface MemoryCanaryDependencies {
  repositoryMode: "MEMORY" | "FIXTURE";
  ports: RunOrchestrationPorts;
  characterResolution: CanaryCharacterResolution;
}

export type CanaryDependencies =
  | ProductionCanaryDependencies
  | MemoryCanaryDependencies;

export function assertOperatorRepositoryMode(
  mode: CanaryRepositoryMode,
): asserts mode is "PRODUCTION" {
  if (mode !== "PRODUCTION") {
    throw Object.assign(
      new Error(
        `operator_canary_refuses_non_production_repositories: repositoryMode=${mode}`,
      ),
      { code: "CANARY_REPOSITORY_MODE_FORBIDDEN" },
    );
  }
}

export function assertNotSentinelCharacterId(characterId: string): void {
  if (characterId === CANARY_SENTINEL_CHARACTER_ID) {
    throw Object.assign(
      new Error("operator_canary_refuses_sentinel_character_id"),
      { code: "CANARY_SENTINEL_CHARACTER_FORBIDDEN" },
    );
  }
}

export async function createProductionCanaryDependencies(input: {
  env: AppEnv;
  identity: CharacterIdentityInput;
  container?: WorkerContainer;
}): Promise<ProductionCanaryDependencies> {
  const container = input.container ?? createWorkerContainer(input.env);
  const character = await container.repositories.character.findByIdentity(
    input.identity,
  );
  if (!character) {
    throw new CharacterNotFoundError(input.identity);
  }
  assertNotSentinelCharacterId(character.id);

  const ports = createProductionRunOrchestrationPorts({
    prisma: container.prisma,
    artifacts: container.repositories.artifacts,
    evidence: container.repositories.evidence,
    // Preflight / operator path: never attach live acquire here.
  });

  return {
    repositoryMode: "PRODUCTION",
    container,
    ports,
    character,
    characterResolution: {
      characterResolutionSource: "postgresql.findByIdentity",
      characterId: character.id,
      characterCanonicalIdentity: {
        region: input.identity.region,
        realmSlug: input.identity.realmSlug,
        name: character.displayName,
      },
      repositoryMode: "PRODUCTION",
    },
  };
}

export function createMemoryCanaryDependencies(input: {
  ports: MemoryOrchestrationPorts | RunOrchestrationPorts;
  characterId: string;
  identity: CharacterIdentityInput;
  repositoryMode?: "MEMORY" | "FIXTURE";
}): MemoryCanaryDependencies {
  return {
    repositoryMode: input.repositoryMode ?? "MEMORY",
    ports: input.ports,
    characterResolution: {
      characterResolutionSource: "test.injected",
      characterId: input.characterId,
      characterCanonicalIdentity: {
        region: input.identity.region,
        realmSlug: input.identity.realmSlug,
        name: input.identity.name,
      },
      repositoryMode: input.repositoryMode ?? "MEMORY",
    },
  };
}
