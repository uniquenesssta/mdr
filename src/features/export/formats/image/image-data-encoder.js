/** Pure Data URL byte conversion. No DOM, I/O, cached image or lifecycle state. */
export class ImageDataEncodingError extends TypeError {
  constructor(cause) {
    super('图片数据无效', cause === undefined ? undefined : { cause });
    this.name = 'ImageDataEncodingError';
  }
}

/**
 * Decode the URL body as bytes, following Fetch's Data URL processing order.
 * URL/TextEncoder preserve surrogate pairs and replace isolated surrogates with
 * U+FFFD. Percent-encoded octets never pass through a UTF-8 text decoder.
 * The caller owns the returned Uint8Array; no input coercion or network fetch.
 */
export function imageDataUrlToBytes(dataUrl) {
  if (typeof dataUrl !== 'string') throw new ImageDataEncodingError();
  let url;
  try { url = new URL(dataUrl); } catch (error) { throw new ImageDataEncodingError(error); }
  if (url.protocol !== 'data:') throw new ImageDataEncodingError();
  url.hash = '';
  const input = url.href.slice(5), comma = input.indexOf(',');
  if (comma < 0) throw new ImageDataEncodingError();
  const header = input.slice(0, comma).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
  const encoded = new TextEncoder().encode(input.slice(comma + 1));
  let length = 0;
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === 37 && index + 2 < encoded.length) {
      const hex = String.fromCharCode(encoded[index + 1], encoded[index + 2]);
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        encoded[length++] = Number.parseInt(hex, 16); index += 2; continue;
      }
    }
    encoded[length++] = encoded[index];
  }
  const bytes = encoded.slice(0, length);
  if (!/; *base64$/i.test(header)) return bytes;
  // Bound spread size for actual long PNGs; never spread the entire payload.
  const parts = [];
  for (let index = 0; index < bytes.length; index += 16384) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + 16384)));
  }
  let binary;
  try { binary = atob(parts.join('')); } catch (error) { throw new ImageDataEncodingError(error); }
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) result[index] = binary.charCodeAt(index);
  return result;
}
