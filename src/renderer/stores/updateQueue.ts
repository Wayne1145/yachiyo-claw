import type { UpdaterFn } from '@shared/types'

// 原子性执行update操作，避免数据竞态
type QueueItem<T extends object> = {
  updater: UpdaterFn<T>
  resolve: (result: T) => void
  reject: (error: unknown) => void
}
export class UpdateQueue<T extends object> {
  private state: T | null = null
  private q: QueueItem<T>[] = []
  private scheduled = false

  constructor(
    private initial: T | (() => Promise<T | null>),
    private onChange?: (s: T | null) => void | Promise<void>
  ) {}

  set(update: UpdaterFn<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.q.push({ updater: update, resolve, reject })
      if (!this.scheduled) {
        this.scheduled = true
        queueMicrotask(() => {
          void this.flush()
        })
      }
    })
  }

  /** 可供测试时手动触发；正常情况下由微任务自动触发 */
  async flush(): Promise<void> {
    if (this.state === null) {
      if (typeof this.initial === 'function') {
        this.state = await (this.initial as () => Promise<T | null>)()
      } else {
        this.state = this.initial
      }
    }
    if (this.q.length === 0) {
      this.scheduled = false
      return
    }
    let s = this.state
    const resolved: { u: QueueItem<T>; s: T }[] = []
    const rejected: { u: QueueItem<T>; e: unknown }[] = []
    for (const u of this.q) {
      try {
        s = u.updater(s)
        // u.resolve(s)
        resolved.push({ u, s })
      } catch (e) {
        // u.reject(e)
        rejected.push({ u, e })
      }
    }

    this.q.length = 0
    const prevState = this.state
    if (s !== this.state) {
      this.state = s
      try {
        const onChangeResult = this.onChange?.(s)
        if (onChangeResult && typeof (onChangeResult as any).then === 'function') {
          await onChangeResult
        }
        this.settleQueue(resolved, rejected)
      } catch (e) {
        // rollback memory state if persistence failed
        this.state = prevState
        // if onChange fails, all updates are considered failed
        this.settleQueue([], [...resolved.map((r) => ({ u: r.u, e })), ...rejected])
      }
    } else {
      this.settleQueue(resolved, rejected)
    }
    if (this.q.length > 0) {
      queueMicrotask(() => {
        void this.flush()
      })
    } else {
      this.scheduled = false
    }
  }

  private settleQueue(resolved: { u: QueueItem<T>; s: T }[], rejected: { u: QueueItem<T>; e: unknown }[]): void {
    for (const r of resolved) {
      r.u.resolve(r.s)
    }
    for (const r of rejected) {
      r.u.reject(r.e)
    }
  }
}
