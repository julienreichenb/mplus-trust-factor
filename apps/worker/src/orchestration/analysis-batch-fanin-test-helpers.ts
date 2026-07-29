export type Status = "PENDING" | "RUNNING" | "SUCCEEDED" | "UNAVAILABLE" | "FAILED";

export function recountForTest(statuses: Status[]): {
  terminalRunCount: number;
  successfulRunCount: number;
  unavailableRunCount: number;
  failedRunCount: number;
  finalizationStatus: "PENDING" | "READY_TO_FINALIZE";
} {
  const successfulRunCount = statuses.filter((s) => s === "SUCCEEDED").length;
  const unavailableRunCount = statuses.filter((s) => s === "UNAVAILABLE").length;
  const failedRunCount = statuses.filter((s) => s === "FAILED").length;
  const terminalRunCount = successfulRunCount + unavailableRunCount + failedRunCount;
  const allTerminal = statuses.length === 0 || terminalRunCount >= statuses.length;
  return {
    terminalRunCount,
    successfulRunCount,
    unavailableRunCount,
    failedRunCount,
    finalizationStatus: allTerminal ? "READY_TO_FINALIZE" : "PENDING",
  };
}
