package expo.modules.orcawear

internal class WearReceiptRetryScheduleGate {
    private var running = false
    private var requestedWhileRunning = false
    private var retired = false

    @Synchronized fun started() {
        running = true
        retired = false
    }

    @Synchronized fun stopped() {
        running = false
        requestedWhileRunning = false
    }

    @Synchronized fun finished(remaining: Boolean, finish: (Boolean) -> Unit) {
        val reschedule = remaining || requestedWhileRunning
        finish(reschedule)
        running = false
        requestedWhileRunning = false
        retired = !reschedule
    }

    @Synchronized fun request(hasPending: () -> Boolean, schedule: () -> Unit) {
        if (running) {
            requestedWhileRunning = true
            return
        }
        if (!retired && hasPending()) return
        schedule()
        retired = false
    }
}
