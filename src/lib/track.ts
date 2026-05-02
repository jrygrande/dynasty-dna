// TODO #84: PostHog wrapper. For now this is a no-op stub so call sites can
// be instrumented at the right point in the flow without taking a runtime
// dependency on a tracking SDK.
export function track(
  _eventName: string,
  _props?: Record<string, unknown>
): void {
  // intentionally empty
}
