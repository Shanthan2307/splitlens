import type { Minor } from "./money";

/**
 * Opaque participant id. Within a group this is a group_members.id (may be a
 * placeholder); for friend-only expenses it is a user id. Callers map ids.
 */
export type ParticipantId = string;

/** A participant's amount in minor units: paid, owed, or net, depending on context. */
export type ParticipantAmount = { participantId: ParticipantId; amount: Minor };

/** "from" owes "to" `amount` (> 0) in `currency`. */
export type Debt = { from: ParticipantId; to: ParticipantId; amount: Minor; currency: string };
