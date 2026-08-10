/**
 * Responsibility: Destroy active lifecycle participants in strict reverse order, remove only
 * successfully destroyed participants from the caller-owned active stack, and collect failures.
 * State ownership: none; the active stack is explicitly owned by application-lifecycle.js.
 */
export async function runShutdownSequence(activeParticipants, context) {
  const errors = [];

  for (let index = activeParticipants.length - 1; index >= 0; index -= 1) {
    const participant = activeParticipants[index];
    try {
      await participant.destroy(context);
      activeParticipants.splice(index, 1);
    } catch (error) {
      errors.push(error);
    }
  }

  return errors;
}
