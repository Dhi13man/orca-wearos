package expo.modules.orcawear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WearReceiptRetryScheduleGateTest {
    @Test fun repeatedRequestsPreserveQueuedDeadline() {
        val gate = WearReceiptRetryScheduleGate()
        var schedules = 0
        gate.request({ false }) { schedules++ }
        gate.request({ true }) { schedules++ }
        assertEquals(1, schedules)
    }

    @Test fun requestDuringRunReschedulesAfterCompletion() {
        val gate = WearReceiptRetryScheduleGate()
        gate.started()
        gate.request({ true }) { error("running job was replaced") }
        var reschedule = false
        gate.finished(false) { reschedule = it }
        assertTrue(reschedule)
    }

    @Test fun requestAfterCompletionReplacesStalePendingEntry() {
        val gate = WearReceiptRetryScheduleGate()
        gate.started()
        var reschedule = true
        gate.finished(false) { reschedule = it }
        assertFalse(reschedule)
        var schedules = 0
        gate.request({ true }) { schedules++ }
        assertEquals(1, schedules)
        gate.request({ true }) { schedules++ }
        assertEquals(1, schedules)
    }
}
