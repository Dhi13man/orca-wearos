package expo.modules.orcawear

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.pm.PackageManager
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class WearFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val kind = message.data["kind"]
        if (kind != "agent-task-complete" && kind != "terminal-bell") return
        val eventId = message.data["eventId"] ?: return
        if (!EVENT_ID.matches(eventId) ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
        val openApp = PendingIntent.getActivity(this, 0, launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID,
            "Orca attention", NotificationManager.IMPORTANCE_DEFAULT))
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(if (kind == "agent-task-complete") "Agent task complete" else "Terminal bell")
            .setContentText("Open Orca Wear to review")
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .build()
        manager.notify("orca-wear:$eventId", 0, notification)
    }

    companion object {
        private const val CHANNEL_ID = "orca-attention"
        private val EVENT_ID = Regex("[A-Za-z0-9:._-]{1,160}")
    }
}
