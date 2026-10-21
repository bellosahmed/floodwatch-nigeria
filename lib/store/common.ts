import { randomBytes } from "crypto";

/** A short random code for the unsubscribe link. 10 characters of base64url is about 60 bits: unguessable in practice. */
export const newUnsubCode = () => randomBytes(8).toString("base64url").slice(0, 10);

/** What makes two subscriptions "the same": one phone, one channel, one area, one hazard. */
export const subscriptionKey = (s: { phoneHash: string; channel: string; state: string; lga?: string; hazard: string }) =>
  [s.phoneHash, s.channel, s.state, s.lga ?? "", s.hazard].join("|");
