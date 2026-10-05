/** A completed provider response was inspected and cannot supply usable data.
 * Do not infer this from a final HTTP status: provider retries may have lost
 * earlier responses. Only the source adapter can establish this outcome. */
export class KnownDiscoveryFailure extends Error {}
export function isKnownDiscoveryFailure(error: unknown): boolean {
  return error instanceof KnownDiscoveryFailure;
}
