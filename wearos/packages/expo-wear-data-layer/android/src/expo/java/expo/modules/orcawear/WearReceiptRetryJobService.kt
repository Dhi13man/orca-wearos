package expo.modules.orcawear

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicInteger

class WearReceiptRetryJobService : JobService() {
    private val generation = AtomicInteger()

    override fun onStartJob(params: JobParameters): Boolean {
        val current = generation.incrementAndGet()
        scheduleGate.started()
        WearCompanionOwner.get(applicationContext).retryPendingReceipts(2) { remaining ->
            Handler(Looper.getMainLooper()).post {
                if (generation.get() == current) {
                    scheduleGate.finished(remaining) { jobFinished(params, it) }
                }
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        generation.incrementAndGet()
        scheduleGate.stopped()
        return true
    }

    companion object {
        private const val JOB_ID = 0x57454152
        private val scheduleGate = WearReceiptRetryScheduleGate()

        fun schedule(context: Context) {
            val scheduler = context.getSystemService(JobScheduler::class.java)
            scheduleGate.request({ scheduler.getPendingJob(JOB_ID) != null }) {
                val job = JobInfo.Builder(JOB_ID, ComponentName(context, WearReceiptRetryJobService::class.java))
                    .setMinimumLatency(30_000)
                    .setBackoffCriteria(60_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .setPersisted(true)
                    .build()
                check(scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS) {
                    "wear_receipt_retry_schedule_failed"
                }
            }
        }
    }
}
