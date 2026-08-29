import { createApplicationContext } from './application-context.js';

export function createApplication(dependencies) {
  const context = createApplicationContext(dependencies);

  return Object.freeze({
    commands: context.commands,
    events: context.events,
    async start() {
      await context.lifecycle.start(context);
    },
    async destroy() {
      await context.lifecycle.destroy(context);
    }
  });
}
