/**
 * API token authn helpers for the Noviscia indexer.
 *
 * The canonical institutional token header is `X-Noviscia-App-Token`; the legacy
 * pro-trader header `x-api-key` is retained as an alias. X-Noviscia-App-Token
 * wins when both are presented. Everything here is pure so the token-contract
 * logic is unit-testable without a database.
 */

export const TOKEN_HEADERS = ['x-noviscia-app-token', 'x-api-key'] as const;

export const TOKEN_SCOPES = ['read', 'write', 'admin'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export function isValidScope(scope: string): scope is TokenScope {
  return (TOKEN_SCOPES as readonly string[]).includes(scope);
}

/** First non-empty token value found across the accepted headers. */
export function extractToken(headers: Record<string, unknown>): string {
  for (const h of TOKEN_HEADERS) {
    const v = headers[h];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}