// Read a single query result through bounded CDP frames and release its handle.
// The wrapper owns only a snapshot string, never an application object or state.
export async function readRemoteString(connection, objectId) {
  if (!objectId) throw new Error('Expected a remote string query result.');
  try {
    const info = await connection.send('Runtime.callFunctionOn', { objectId,
      functionDeclaration: 'function () { if (typeof this.value !== "string") throw Error("Expected string query result"); return this.value.length; }', returnByValue: true });
    if (info.exceptionDetails) throw new Error(info.exceptionDetails.text);
    const length = info.result?.value;
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid remote string length.');
    const chunks = [], chunkSize = 128 * 1024;
    for (let start = 0; start < length; start += chunkSize) {
      const chunk = await connection.send('Runtime.callFunctionOn', { objectId,
        functionDeclaration: 'function (start, size) { return this.value.slice(start, start + size); }',
        arguments: [{ value: start }, { value: chunkSize }], returnByValue: true });
      if (chunk.exceptionDetails || typeof chunk.result?.value !== 'string') throw new Error('Remote string slice failed.');
      chunks.push(chunk.result.value);
    }
    const value = chunks.join('');
    if (value.length !== length) throw new Error('Remote string transport was incomplete.');
    return value;
  } finally { await connection.send('Runtime.releaseObject', { objectId }); }
}
