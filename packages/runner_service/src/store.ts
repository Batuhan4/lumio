import fs from "node:fs/promises";
import path from "node:path";
import { RunnerRun, RunnerRunStatus } from "./types.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class RunnerStore {
  private readonly filePath: string;
  private runs = new Map<string, RunnerRun>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await this.load();
  }

  async clear(): Promise<void> {
    this.runs.clear();
    await this.persist();
  }

  list(): RunnerRun[] {
    return Array.from(this.runs.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((run) => clone(run));
  }

  get(id: string): RunnerRun | undefined {
    const run = this.runs.get(id);
    return run ? clone(run) : undefined;
  }

  getNextPending(): RunnerRun | undefined {
    for (const run of this.runs.values()) {
      if (run.status === "pending") {
        return clone(run);
      }
    }
    return undefined;
  }

  async add(run: RunnerRun): Promise<RunnerRun> {
    if (this.runs.has(run.id)) {
      throw new Error(`Run with id ${run.id} already exists.`);
    }
    this.runs.set(run.id, clone(run));
    await this.persist();
    return clone(run);
  }

  async update(
    id: string,
    patch?: Partial<Omit<RunnerRun, "id" | "createdAt">>,
  ): Promise<RunnerRun | undefined> {
    const existing = this.runs.get(id);
    if (!existing) {
      return undefined;
    }
    const effectivePatch = patch ? clone(patch) : {};
    const updated: RunnerRun = {
      ...existing,
      ...effectivePatch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(id, updated);
    await this.persist();
    return clone(updated);
  }

  async updateStatus(
    id: string,
    status: RunnerRunStatus,
    patch?: Partial<Omit<RunnerRun, "id" | "createdAt" | "status">>,
  ): Promise<RunnerRun | undefined> {
    return this.update(id, {
      ...patch,
      status,
    });
  }

  async remove(id: string): Promise<void> {
    this.runs.delete(id);
    await this.persist();
  }

  private async load(): Promise<void> {
    try {
      const payload = await fs.readFile(this.filePath, "utf8");
      const parsed: RunnerRun[] = JSON.parse(payload);
      this.runs = new Map(parsed.map((run) => [run.id, run]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await this.persist();
        return;
      }
      throw error;
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify(Array.from(this.runs.values()), null, 2) + "\n",
      "utf8",
    );
  }
}
