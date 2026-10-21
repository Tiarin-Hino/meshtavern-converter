/**
 * The SHA-256 of a source file for the paint file (#167, design note
 * `docs/design/painter-on-the-page.md` §7.4), off the page's thread: `crypto.subtle.digest` copies
 * its input on the thread that calls it, a quarter of a second of stall for a 280 MB file on the
 * page's. The page reads the file again and transfers that buffer here, so nothing is copied there.
 */
self.onmessage = async (event: MessageEvent<{ id: number; bytes: ArrayBuffer }>) => {
  const { id, bytes } = event.data;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  self.postMessage({ id, bytes: bytes.byteLength, sha256 });
};
