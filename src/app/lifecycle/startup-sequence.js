/**
 * Responsibility: Start lifecycle participants in registration order and append only
 * successfully started participants to the lifecycle-owned active stack supplied by the caller.
 * State ownership: none; the active stack is explicitly owned by application-lifecycle.js.
 */
export async function runStartupSequence(participants, activeParticipants, context) {
  for (const participant of participants) {
    await participant.start(context);
    activeParticipants.push(participant);
  }
}
