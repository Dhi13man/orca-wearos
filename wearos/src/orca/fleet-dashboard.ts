import { fetchRuntimeDashboard } from './direct-orca-client'
import type { PairingOffer } from './pairing'
import type { OrcaDashboard } from './runtime-dashboard'

export type FleetHost = {
  pairing: PairingOffer
  dashboard: OrcaDashboard | null
  observedAt: number | null
  checkedAt: number
  error: string | null
  cached?: boolean
  agentsOmitted?: number
}

export async function refreshFleet(
  pairings: PairingOffer[],
  previous: FleetHost[] = [],
  fetchDashboard: typeof fetchRuntimeDashboard = fetchRuntimeDashboard,
  now: () => number = Date.now,
  signal?: AbortSignal,
  isActive: () => boolean = () => true
): Promise<FleetHost[]> {
  const priorByEndpoint = new Map(previous.map((host) => [host.pairing.endpoint, host]))
  const results: FleetHost[] = []
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < pairings.length) {
      if (signal?.aborted || !isActive()) {
        throw new Error('Orca refresh cancelled')
      }
      const index = nextIndex++
      const pairing = pairings[index]
      const saved = priorByEndpoint.get(pairing.endpoint)
      const prior =
        saved?.pairing.publicKeyB64 === pairing.publicKeyB64 &&
        saved.pairing.deviceToken === pairing.deviceToken
          ? saved
          : undefined
      try {
        const dashboard = await fetchDashboard(pairing, { signal })
        if (signal?.aborted || !isActive()) {
          throw new Error('Orca refresh cancelled')
        }
        const checkedAt = now()
        results[index] = {
          pairing,
          dashboard,
          observedAt: checkedAt,
          checkedAt,
          error: null,
          cached: false
        }
      } catch (caught) {
        if (signal?.aborted || !isActive()) {
          throw caught
        }
        results[index] = {
          pairing,
          dashboard: prior?.dashboard ?? null,
          observedAt: prior?.observedAt ?? null,
          checkedAt: now(),
          error: caught instanceof Error ? caught.message : 'Could not reach Orca',
          cached: prior?.cached,
          agentsOmitted: prior?.agentsOmitted
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, pairings.length) }, worker))
  if (signal?.aborted || !isActive()) {
    throw new Error('Orca refresh cancelled')
  }
  return results
}
