package expo.modules.orcawear

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class WearActionHeadlessService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? =
        if (intent?.action == ACTION) HeadlessJsTaskConfig(
            "OrcaWearActionDrain", Arguments.createMap(), 30_000, true
        ) else null

    companion object { const val ACTION = "dev.orca.wear.DRAIN_ACTIONS" }
}
