import { SignJWT, jwtVerify } from 'jose';

export interface Claims {
  sub: string; // usuario_id
  emp: string; // empresa_id
}

const ISSUER = 'obraclara';

export async function firmar(claims: Claims, secret: string, ttl = '12h'): Promise<string> {
  return new SignJWT({ emp: claims.emp })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}

export async function verificar(token: string, secret: string): Promise<Claims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: ISSUER });
  if (typeof payload.sub !== 'string' || typeof payload.emp !== 'string') {
    throw new Error('Token sin sujeto o empresa');
  }
  return { sub: payload.sub, emp: payload.emp };
}
