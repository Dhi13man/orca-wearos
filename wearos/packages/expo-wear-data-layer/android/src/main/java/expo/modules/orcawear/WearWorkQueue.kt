package expo.modules.orcawear

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal class WearWorkTicket {
    @Volatile private var live = true
    private var admittedEffect = false
    fun isLive() = live
    fun checkLive() = check(isLive()) { "wear_work_expired" }
    @Synchronized fun finish(): Boolean {
        if (!live) return false
        live = false
        return true
    }
    @Synchronized fun hasEffects() = admittedEffect
    fun effect(operation: () -> Unit) {
        synchronized(this) {
            checkLive()
            admittedEffect = true
        }
        operation()
    }
}

internal class WearWorkQueue : AutoCloseable {
    private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(8),
        { Thread(it, "orca-wear-crypto").apply { isDaemon = true } }, ThreadPoolExecutor.AbortPolicy())
    private val deadlines = ScheduledThreadPoolExecutor(1) {
        Thread(it, "orca-wear-deadline").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }
    private val tickets = mutableMapOf<WearWorkTicket, (Exception?) -> Unit>()
    private var closed = false

    fun submit(timeoutMillis: Long, operation: (WearWorkTicket) -> Unit, completed: (Exception?) -> Unit): Boolean {
        require(timeoutMillis in 1..120_000)
        val ticket = WearWorkTicket()
        synchronized(tickets) {
            if (closed) { completed(IllegalStateException("wear_work_closed")); return false }
            if (tickets.size >= 9) { completed(IllegalStateException("wear_work_busy")); return false }
            tickets[ticket] = completed
        }
        val timeout = try {
            deadlines.schedule({ complete(ticket, IllegalStateException("wear_work_timeout")) }, timeoutMillis, TimeUnit.MILLISECONDS)
        } catch (error: RejectedExecutionException) {
            complete(ticket, IllegalStateException("wear_work_closed"))
            return false
        }
        return try {
            worker.execute {
                try {
                    if (ticket.isLive()) {
                        operation(ticket)
                        complete(ticket, null)
                    }
                } catch (error: Exception) {
                    complete(ticket, error)
                } finally { timeout.cancel(false) }
            }
            true
        } catch (error: RejectedExecutionException) {
            timeout.cancel(false)
            complete(ticket, IllegalStateException("wear_work_busy"))
            false
        }
    }

    private fun complete(ticket: WearWorkTicket, error: Exception?) {
        if (!ticket.finish()) return
        val callback = synchronized(tickets) { tickets.remove(ticket) }
        val result = if (error != null && ticket.hasEffects() &&
            error.message in listOf("wear_work_timeout", "wear_work_closed"))
            IllegalStateException("wear_work_unknown") else error
        callback?.invoke(result)
    }

    override fun close() {
        val pending = synchronized(tickets) {
            closed = true
            tickets.keys.toList()
        }
        pending.forEach { complete(it, IllegalStateException("wear_work_closed")) }
        worker.shutdownNow()
        deadlines.shutdownNow()
    }
}
