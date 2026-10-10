// Own test-host startup attempts and cleanup. A failed product assertion is never retried.
// Dependencies are explicit so recovery boundaries can be verified without native automation.
export async function runEmbeddedSession({ start, connect, prepare, recordFailure, isRecoverable }, run) {
  let priorFailure = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let application = null, browser = null, stage = 'start', failure = null, recover = false;
    try {
      application = await start(attempt);
      stage = 'connect';
      browser = await connect(application);
      stage = 'prepare';
      const surface = await prepare(browser);
      stage = 'run';
      return await run(browser, surface);
    } catch (error) {
      failure = error;
      recover = attempt === 1 && stage === 'connect' && application?.isRunning() === true && isRecoverable(error);
      try { await recordFailure({ attempt, stage, application, error, recover }); }
      catch (diagnosticError) {
        recover = false;
        failure = new AggregateError([failure, diagnosticError], 'Embedded session failed and diagnostics could not be saved.');
      }
    } finally {
      const cleanupErrors = [];
      try { if (browser) await browser.deleteSession(); } catch (error) { cleanupErrors.push(error); }
      try {
        if (application) {
          await application.stop();
          if(application.isRunning())throw new Error('Native test host is still running after cleanup.');
        }
      } catch (error) { cleanupErrors.push(error); }
      if (cleanupErrors.length) throw new AggregateError(
        [...(priorFailure?[priorFailure]:[]),...(failure?[failure]:[]),...cleanupErrors],
        'Embedded session cleanup failed; startup recovery is blocked.'
      );
    }
    if (!recover) throw priorFailure
      ? new AggregateError([priorFailure,failure],'Both embedded window startup attempts failed.')
      : failure;
    priorFailure = failure;
    // The first host is confirmed stopped; the next start must create a fresh process.
  }
}
