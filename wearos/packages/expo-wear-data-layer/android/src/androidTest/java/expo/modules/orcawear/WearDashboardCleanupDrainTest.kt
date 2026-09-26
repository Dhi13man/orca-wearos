package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test

class WearDashboardCleanupDrainTest {
    @Test fun drainsMoreThanOneLegacyBatchAndContinuesAfterSixtyFour() {
        val pending = (1..65).map { StaleWearDashboardItem("binding", it.toLong(), "dashboard/$it") }
            .toMutableList()
        val deleted = mutableListOf<Long>()
        val next = { pending.firstOrNull() }
        val delete: (StaleWearDashboardItem) -> Boolean = {
            deleted.add(it.revision)
            pending.removeAt(0)
            true
        }
        assertEquals(WearCleanupDrainResult.CONTINUE, drainWearDashboardCleanup(next, delete))
        assertEquals(64, deleted.size)
        assertEquals(WearCleanupDrainResult.EMPTY, drainWearDashboardCleanup(next, delete))
        assertEquals((1L..65L).toList(), deleted)
    }

    @Test fun failedDeleteRetainsItemForRetry() {
        val item = StaleWearDashboardItem("binding", 1, "dashboard/1")
        var attempts = 0
        assertEquals(WearCleanupDrainResult.RETRY, drainWearDashboardCleanup({ item }) {
            attempts++
            false
        })
        assertEquals(1, attempts)
        var pending: StaleWearDashboardItem? = item
        assertEquals(WearCleanupDrainResult.EMPTY, drainWearDashboardCleanup({ pending }) {
            pending = null
            true
        })
    }
}
