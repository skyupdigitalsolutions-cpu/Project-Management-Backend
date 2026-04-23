/**
 * services/eventBus.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Central event bus for the entire application.
 * Uses Node's built-in EventEmitter — zero extra dependencies.
 *
 * EVENTS EMITTED:
 *   project:created   { project, taskDrafts, adminId }
 *   task:created      { task, adminId }
 *   task:updated      { taskId, before, after, adminId }
 *   leave:approved    { leave, adminId }
 *   workload:exceeded { userId, projectId, score, adminId }
 *
 * HOW TO EMIT  (in a controller or service):
 *   const eventBus = require('../services/eventBus');
 *   eventBus.emit('project:created', { project, taskDrafts, adminId });
 *
 * HOW TO LISTEN (in a handler file, registered once at startup):
 *   eventBus.on('project:created', async (payload) => { ... });
 *
 * IMPORTANT: All listeners are registered in services/workflowHandlers.js
 * which is imported once in server.js after DB connects.
 */

const { EventEmitter } = require('events');

class AppEventBus extends EventEmitter {
  constructor() {
    super();
    // Increase listener limit — we have multiple handlers per event
    this.setMaxListeners(20);
  }

  /**
   * Safe async emit — wraps each listener in try/catch so one failing
   * listener never crashes others or the calling controller.
   *
   * Usage: await eventBus.emitAsync('project:created', payload)
   * (fire-and-forget from controllers: eventBus.emitAsync(...).catch(console.error))
   */
  async emitAsync(event, payload) {
    const listeners = this.rawListeners(event);
    await Promise.allSettled(
      listeners.map((listener) => Promise.resolve(listener(payload)))
    );
  }
}

const eventBus = new AppEventBus();

module.exports = eventBus;