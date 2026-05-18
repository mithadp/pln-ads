/**
 * Simple in-memory FIFO queue for background jobs.
 *
 * Replaces the BullMQ/Redis-backed worker for local-only deployments where
 * standing up Redis is overkill. Jobs run sequentially in a single async
 * loop so file processing keeps the same one-at-a-time semantics as before.
 *
 * Trade-offs vs. BullMQ:
 *   - No persistence: jobs in flight are lost on process restart.
 *   - No retries/backoff: a thrown error just fails that job.
 *   - No cross-process fan-out: one Node process handles its own queue.
 * For a local dev / single-instance deployment those trade-offs are fine.
 */
import { logger } from './logger'

export interface QueueJob<T> {
  id: string
  data: T
}

type Processor<T> = (job: QueueJob<T>) => Promise<void>

export class InMemoryQueue<T> {
  private readonly name: string
  private readonly buffer: QueueJob<T>[] = []
  private processor: Processor<T> | null = null
  private running = false
  private seq = 0

  constructor(name: string) {
    this.name = name
  }

  setProcessor(fn: Processor<T>): void {
    this.processor = fn
    logger.info(`👷 [Queue:${this.name}] processor registered`)
    // Kick the drain loop in case jobs were enqueued before the processor.
    this.drain()
  }

  add(data: T): QueueJob<T> {
    this.seq += 1
    const job: QueueJob<T> = { id: `${this.name}-${Date.now()}-${this.seq}`, data }
    this.buffer.push(job)
    logger.info(`📨 [Queue:${this.name}] enqueued job ${job.id} (depth=${this.buffer.length})`)
    // Fire and forget — drain advances on its own.
    void this.drain()
    return job
  }

  size(): number {
    return this.buffer.length
  }

  private async drain(): Promise<void> {
    if (this.running) return
    if (!this.processor) return
    this.running = true
    try {
      while (this.buffer.length > 0) {
        const job = this.buffer.shift()!
        const started = Date.now()
        try {
          await this.processor(job)
          logger.info(`✅ [Queue:${this.name}] job ${job.id} finished in ${Date.now() - started}ms`)
        } catch (err: any) {
          logger.error(`❌ [Queue:${this.name}] job ${job.id} failed: ${err?.message ?? err}`)
        }
      }
    } finally {
      this.running = false
    }
  }
}
