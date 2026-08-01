import type { JobStatusDTO } from "@mplus/contracts";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { mapJobStatusWithEta } from "./refresh-eta-service.js";

export class JobService {
  constructor(private readonly container: ApiContainer) {}

  async getJob(id: string): Promise<JobStatusDTO> {
    const job = await this.container.worker.repositories.job.findById(id);
    if (!job) {
      throw HttpError.notFound("JOB_NOT_FOUND", `Job ${id} was not found`);
    }
    const dto = await mapJobStatusWithEta(this.container, job);
    if (!dto) {
      throw HttpError.notFound("JOB_NOT_FOUND", `Job ${id} was not found`);
    }
    return dto;
  }
}
