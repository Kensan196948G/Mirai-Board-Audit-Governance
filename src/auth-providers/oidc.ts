import { b64url, b64urlDecode } from "../auth.ts";

/**
 * OIDC/SSO 本実装（バックログ B-02）の下地。
 *
 * 既定では未設定（issuer/clientId/clientSecret/redirectUri のいずれかが空）であり、
 * その間は `isOidcConfigured()` が false を返すため、既存のデモログイン（/api/auth/login）の
 * 動作には一切影響しない。実IdP（Azure AD / Okta / Auth0 等）と接続する場合のみ、
 * 環境変数 OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_REDIRECT_URI を設定する。
 *
 * 対応: Authorization Code + PKCE（RFC 7636）、IDトークンのRS256署名検証（JWKS）。
 * MFAの要求可否はIdP側のポリシー（Conditional Access等）に委譲する。
 */

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function isOidcConfigured(config: Partial<OidcConfig>): config is OidcConfig {
  return Boolean(config.issuer && config.clientId && config.clientSecret && config.redirectUri);
}

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };

const discoveryCache = new Map<string, { value: Discovery; expiresAt: number }>();
const jwksCache = new Map<string, { value: Jwk[]; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

async function discover(issuer: string): Promise<Discovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const value = (await res.json()) as Discovery;
  discoveryCache.set(issuer, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function getJwks(jwksUri: string): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const res = await fetch(jwksUri, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache.set(jwksUri, { value: body.keys, expiresAt: Date.now() + CACHE_TTL_MS });
  return body.keys;
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return b64url(String.fromCharCode(...arr));
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = b64url(String.fromCharCode(...new Uint8Array(digest)));
  return { verifier, challenge };
}

export function newState(): string {
  return randomToken(16);
}

export function newNonce(): string {
  return randomToken(16);
}

export async function buildAuthorizeUrl(
  config: OidcConfig,
  params: { state: string; nonce: string; codeChallenge: string },
): Promise<string> {
  const discovery = await discover(config.issuer);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCode(
  config: OidcConfig,
  code: string,
  codeVerifier: string,
): Promise<{ idToken: string }> {
  const discovery = await discover(config.issuer);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("token response missing id_token");
  return { idToken: json.id_token };
}

export type VerifiedIdToken = {
  sub: string;
  email?: string;
  name?: string;
};

/** IDトークンのRS256署名・iss/aud/exp/nonceを検証する（未対応algは拒否） */
export async function verifyIdToken(
  config: OidcConfig,
  idToken: string,
  expectedNonce: string,
): Promise<VerifiedIdToken> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed id_token");
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
  const header = JSON.parse(b64urlDecode(headerB64)) as { kid?: string; alg?: string };
  // 注意（既知の制約）: メールアドレスは ID トークンのクレームからのみ取得する。
  // UserInfo エンドポイントへのフォールバックは未実装のため、ID トークンに email を
  // 含めない構成のIdPでは本フローでのログインができない（実接続時に個別対応が必要）。
  const payload = JSON.parse(b64urlDecode(payloadB64)) as {
    iss: string;
    aud: string | string[];
    exp: number;
    nonce?: string;
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (header.alg !== "RS256") throw new Error(`unsupported alg: ${header.alg}`);
  const discovery = await discover(config.issuer);
  const jwks = await getJwks(discovery.jwks_uri);
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("signing key not found in JWKS");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = Uint8Array.from(atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signatureBytes, signedData);
  if (!valid) throw new Error("id_token signature invalid");
  if (payload.iss !== discovery.issuer) throw new Error("iss mismatch");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.clientId)) throw new Error("aud mismatch");
  if (payload.exp * 1000 < Date.now()) throw new Error("id_token expired");
  if (payload.nonce !== expectedNonce) throw new Error("nonce mismatch");
  if (payload.email && payload.email_verified !== true) {
    throw new Error("email not verified by IdP");
  }
  return { sub: payload.sub, email: payload.email, name: payload.name };
}
