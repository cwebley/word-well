export const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
export const maxSyncOperations = 100;
export const recentAuthenticationLifetimeMs = 5 * 60 * 1000;
export const recoveryTokenLifetimeMs = 15 * 60 * 1000;
export const challengeLifetimeMs = 5 * 60 * 1000;

export const permittedKinds = [
  "familiarity",
  "practice",
  "active-use",
  "utility",
  "content-quality"
] as const;

export type OperationKind = (typeof permittedKinds)[number];

export type SyncOperation = {
  readonly id: string;
  readonly kind: OperationKind;
  readonly deliveryId: string;
  readonly createdAt: string;
  readonly familiarity?: string;
  readonly correct?: boolean;
  readonly activeUse?: string;
  readonly utility?: string;
};

export type LearnerState = {
  readonly lessons: readonly Record<string, unknown>[];
  readonly history: readonly Record<string, unknown>[];
  readonly evidence: readonly Record<string, unknown>[];
  readonly mutable: readonly Record<string, unknown>[];
  readonly delivery?: Record<string, unknown>;
  readonly upcoming?: readonly Record<string, unknown>[];
};

export type ActiveResponse = {
  readonly status: "active";
  readonly state: LearnerState;
};

export type Session = {
  readonly grant: string;
  readonly expiresAt: string;
};

export type RepositoryResponse =
  | ActiveResponse
  | { readonly status: "deleted" }
  | { readonly status: "session-expired" };

export type Passkey = {
  readonly id: string;
  readonly label: string;
};

export type PasskeyCredential = {
  readonly id: string;
  readonly label: string;
  readonly publicKey: string;
  readonly challenge: string;
};

export type ProfileState = "anonymous" | "protected";

export type Profile = {
  readonly state: ProfileState;
  readonly canProtect: boolean;
  readonly passkeys: readonly Passkey[];
  readonly recoveryEmail: string | null;
};

export type RetentionSchedule = {
  readonly liveDataPurgeAt: string;
  readonly profileAnalyticsPurgeAt: string;
  readonly backupExpiryAt: string;
  readonly securityRecordExpiryAt: string;
  readonly requestIpLogExpiryAt: string;
};

export type ProfileResponse =
  | { readonly status: "anonymous"; readonly profile: Profile }
  | { readonly status: "protected"; readonly profile: Profile }
  | { readonly status: "authentication-required" }
  | { readonly status: "tombstoned"; readonly deletedAt: string; readonly retention: RetentionSchedule }
  | { readonly status: "deleted" }
  | { readonly status: "session-expired" };

export type PasskeyChallenge = {
  readonly challenge: string;
  readonly expiresAt: string;
};
