import type { WearAgentRow } from '../packages/wear-companion-contract/src/agent-page'

export function selectCurrentWearAgent(
  agents: readonly WearAgentRow[],
  selected: WearAgentRow
): WearAgentRow | null {
  return (
    agents.find(
      (agent) =>
        agent.workspaceId === selected.workspaceId &&
        agent.workspaceKind === selected.workspaceKind &&
        agent.sessionTabId === selected.sessionTabId &&
        agent.kind === selected.kind &&
        agent.targetPublicationEpoch === selected.targetPublicationEpoch
    ) ?? null
  )
}
