import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

type StoredCredential = {
  id: string;
  publicKey: string;
  counter: number;
  transports: string[];
};

const rpID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const expectedOrigin = (process.env.WEBAUTHN_ORIGINS ?? "http://localhost:8080")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function registrationOptions(profileId: string, passkeys: readonly { id: string }[]) {
  return generateRegistrationOptions({
    rpName: "WordWell",
    rpID,
    userID: new TextEncoder().encode(profileId),
    userName: `wordwell-${profileId}`,
    attestationType: "none",
    excludeCredentials: passkeys.map(({ id }) => ({ id })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

export function authenticationOptions(passkeys?: readonly { id: string }[]) {
  return generateAuthenticationOptions({
    rpID,
    ...(passkeys ? { allowCredentials: passkeys.map(({ id }) => ({ id })) } : {}),
    userVerification: "required",
  });
}

export async function verifyRegistration(response: Record<string, unknown>, challenge: string) {
  const verification = await verifyRegistrationResponse({
    response: response as any,
    expectedChallenge: challenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) return undefined;
  const credential = verification.registrationInfo.credential;
  return {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceType: verification.registrationInfo.credentialDeviceType,
    backedUp: verification.registrationInfo.credentialBackedUp,
  };
}

export async function verifyAuthentication(response: Record<string, unknown>, challenge: string, credential: StoredCredential) {
  const verification = await verifyAuthenticationResponse({
    response: response as any,
    expectedChallenge: challenge,
    expectedOrigin,
    expectedRPID: rpID,
    credential: {
      id: credential.id,
      publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
      counter: credential.counter,
      transports: credential.transports as any,
    },
    requireUserVerification: true,
  });
  return verification.verified ? verification.authenticationInfo.newCounter : undefined;
}
