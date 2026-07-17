/**
 * Token Estimation Initialization
 *
 * Initializes the token estimation system:
 * - Sets up the task executor
 * - Connects the result persister
 * - Starts periodic cleanup
 * - Exposes debug tools in development mode
 */

import { getLogger } from '@/lib/utils'
import { computationQueue } from '@/packages/token-estimation/computation-queue'
import { resultPersister } from '@/packages/token-estimation/result-persister'
import { initializeExecutor, setResultPersister } from '@/packages/token-estimation/task-executor'

const log = getLogger('token-estimation:init')

// Initialize the token estimation system (runs in ALL environments)
log.info('Initializing token estimation system')

// Connect the result persister to the executor
setResultPersister(resultPersister)

// Initialize the executor (connects to the queue)
initializeExecutor()

// Start periodic cleanup of completed task IDs
computationQueue.startCleanup()

log.info('Token estimation system initialized')

// Expose debug tools in development mode only
if (process.env.NODE_ENV === 'development') {
  ;(window as any).__tokenEstimation = {
    queue: computationQueue,
    persister: resultPersister,
    getStatus: () => computationQueue.getStatus(),
    getPendingTasks: () => computationQueue.getPendingTasks(),
    startCleanup: () => computationQueue.startCleanup(),
    stopCleanup: () => computationQueue.stopCleanup(),
  }
  log.info('Token estimation dev tools available at window.__tokenEstimation')
}
