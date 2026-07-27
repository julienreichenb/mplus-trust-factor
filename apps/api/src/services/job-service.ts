import type { JobStatusDTO } from "@mplus/contracts";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { mapJobStatus } from "../lib/mappers.js";

export class JobService {
  constructor(private readonly container: ApiContainer) {}

  async getJob(id: string): Promise<JobStatusDTO> {
    const job = await this.container.worker.repositories.job.findById(id);
    if (!job) {
      throw HttpError.notFound("JOB_NOT_FOUND", `Job ${id} was not found`);
    }
    return mapJobStatus(job);
  }
}
