import {
  createStaticAbilityCatalogPin,
  type AbilityCatalogExecutionPin,
} from "@mplus/contracts";

/** Explicit STATIC pin for contract/regression tests only — not runtime authority. */
export const TEST_STATIC_ABILITY_CATALOG_PIN: AbilityCatalogExecutionPin =
  createStaticAbilityCatalogPin("12.0.0/midnight-season-1");

/** Bootstrap Release 0 identity for integration tests after seed-active-bootstrap. */
export const BOOTSTRAP_TEST_RELEASE_PIN = {
  kind: "RELEASE",
  releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
  releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
  contentDigest:
    "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
  schemaVersion: "ability-catalog-release-v1",
} as const satisfies AbilityCatalogExecutionPin;

/** Minimal prisma mock fragment for resolveEnqueueAbilityCatalogExecutionPin in unit tests. */
export function mockActiveBootstrapCatalogReleasePrisma() {
  return {
    abilityCatalogRelease: {
      findFirst: async () => ({
        id: BOOTSTRAP_TEST_RELEASE_PIN.releaseId,
        releaseKey: BOOTSTRAP_TEST_RELEASE_PIN.releaseKey,
        contentDigest: BOOTSTRAP_TEST_RELEASE_PIN.contentDigest,
        schemaVersion: BOOTSTRAP_TEST_RELEASE_PIN.schemaVersion,
        status: "ACTIVE",
      }),
    },
  };
}
