package expo.modules.orcawear

internal data class StaleWearDashboardItem(val bindingId: String, val revision: Long, val path: String)

internal enum class WearCleanupDrainResult { EMPTY, CONTINUE, RETRY }

internal fun drainWearDashboardCleanup(
    nextStale: () -> StaleWearDashboardItem?,
    delete: (StaleWearDashboardItem) -> Boolean
): WearCleanupDrainResult {
    repeat(64) {
        val stale = nextStale() ?: return WearCleanupDrainResult.EMPTY
        if (!delete(stale)) return WearCleanupDrainResult.RETRY
    }
    return WearCleanupDrainResult.CONTINUE
}
