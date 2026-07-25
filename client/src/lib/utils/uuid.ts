/**
 * Create a UUID without requiring the secure-context-only randomUUID API.
 */
export function createUuid(): string {
  const webCrypto =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  if (typeof webCrypto?.getRandomValues === "function") {
    try {
      const bytes = new Uint8Array(16);
      webCrypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");

      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join("-");
    } catch {
      // Fall through to the non-cryptographic fallback when Web Crypto is
      // present but unavailable in the current browser context.
    }
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
