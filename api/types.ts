export const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
export const maxSyncOperations = 100;

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
