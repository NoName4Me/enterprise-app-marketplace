class IdentityMismatch extends Error {}

export async function verifyService(baseURL, revision, faultMode, { attempts = 5, delayMs = 300, timeoutMs = 1000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      // Containers replace the server behind the same host port; never reuse an old keep-alive socket.
      const options = () => ({ headers: { Connection: "close" }, signal: AbortSignal.timeout(timeoutMs) });
      const versionResponse = await fetch(`${baseURL}/version`, options());
      const version = await versionResponse.json();
      const health = await fetch(`${baseURL}/health`, options());
      if (!versionResponse.ok || version.service !== "marketplace-lab" || version.environment !== "local-lab" || version.revision !== revision || version.faultMode !== faultMode || health.status !== 200) {
        throw new IdentityMismatch("Actual service version/health mismatch.");
      }
      return;
    } catch (error) {
      if (error instanceof IdentityMismatch || attempt === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
