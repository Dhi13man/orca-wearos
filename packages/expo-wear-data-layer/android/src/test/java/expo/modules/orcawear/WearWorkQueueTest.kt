package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class WearWorkQueueTest {
    @Test fun deadlineReportsAnAdmittedBlockedEffectAsUnknown() {
        val queue = WearWorkQueue()
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val callback = CountDownLatch(1)
        val keepWorker = CountDownLatch(1)
        try {
            queue.submit(1000, { ticket ->
                ticket.effect { entered.countDown(); release.await() }
                keepWorker.await()
            }, {
                assertEquals("wear_work_unknown", it?.message)
                callback.countDown()
            })
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            assertTrue(callback.await(5, TimeUnit.SECONDS))
            assertEquals(1L, release.count)
            release.countDown()
        } finally {
            release.countDown()
            keepWorker.countDown()
            queue.close()
        }
    }

    @Test fun timeoutFencesLateWorkWithoutGrowingWorkers() {
        val queue = WearWorkQueue()
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val timedOut = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val calls = AtomicInteger()
        try {
            assertTrue(queue.submit(1000, { ticket ->
                started.countDown()
                release.await()
                try { ticket.checkLive() } finally { finished.countDown() }
                fail("Expired work reached its effect")
            }, {
                assertEquals("wear_work_timeout", it?.message)
                calls.incrementAndGet()
                timedOut.countDown()
            }))
            assertTrue(started.await(5, TimeUnit.SECONDS))
            assertTrue(timedOut.await(5, TimeUnit.SECONDS))
            repeat(8) { assertTrue(queue.submit(120_000, { }, { })) }
            assertFalse(queue.submit(120_000, { fail("Queue overflow executed") }, {
                assertEquals("wear_work_busy", it?.message)
            }))
            release.countDown()
            assertTrue(finished.await(5, TimeUnit.SECONDS))
            assertEquals(1, calls.get())
        } finally {
            release.countDown()
            queue.close()
        }
    }
}
