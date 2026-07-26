const globalAuth = globalThis as typeof globalThis & {
  __agentMatrixRendererToken?: string;
};

export function setRendererApiToken(token: string): void {
  globalAuth.__agentMatrixRendererToken = token;
}

export function verifyRendererApiRequest(request: Request): boolean {
  const expected = globalAuth.__agentMatrixRendererToken;
  // Standalone browser/server mode has no Electron-controlled renderer token.
  // Electron — the production desktop boundary — always initializes a token.
  if (!expected) return true;
  return request.headers.get('x-agentmatrix-renderer-token') === expected;
}
