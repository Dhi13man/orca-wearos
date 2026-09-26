package expo.modules.orcawear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.WearableListenerService

class WearCompanionListenerService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        val owner = WearCompanionOwner.get(applicationContext)
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val item = event.dataItem
            val nodeId = item.uri.host ?: continue
            val path = item.uri.path ?: continue
            val bytes = item.data ?: continue
            owner.receiveDashboard(nodeId, path, bytes)
        }
    }

    override fun onMessageReceived(event: MessageEvent) {
        WearCompanionOwner.get(applicationContext).receive(event.sourceNodeId, event.path, event.data)
    }
}
