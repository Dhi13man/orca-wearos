package expo.modules.orcawear

import android.app.Activity
import android.content.Intent
import com.google.android.gms.wearable.Wearable
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoWearDataLayerModule : Module() {
    private var pendingTextPromise: Promise? = null
    private val observer: (Map<String, Any>) -> Unit = { sendEvent("onState", it) }
    private val dashboardObserver: (String) -> Unit = { sendEvent("onDashboardChanged", mapOf("bindingId" to it)) }
    private val actionObserver: (String, String) -> Unit = { bindingId, requestId ->
        sendEvent("onActionChanged", mapOf("bindingId" to bindingId, "requestId" to requestId))
    }
    private val pageObserver: (String, String) -> Unit = { bindingId, requestId ->
        sendEvent("onPageChanged", mapOf("bindingId" to bindingId, "requestId" to requestId))
    }
    private val owner get() = WearCompanionOwner.get(requireNotNull(appContext.reactContext))
    private var observedOwner: WearCompanionOwner? = null

    override fun definition() = ModuleDefinition {
        Name("ExpoWearDataLayer")
        Events("onState", "onDashboardChanged", "onActionChanged", "onPageChanged")
        OnStartObserving {
            owner.also { observedOwner = it }.observe(observer)
            owner.observeDashboard(dashboardObserver)
            owner.observeAction(actionObserver)
            owner.observePage(pageObserver)
        }
        OnStopObserving {
            observedOwner?.stopObserving(observer)
            observedOwner?.stopObservingDashboard(dashboardObserver)
            observedOwner?.stopObservingAction(actionObserver)
            observedOwner?.stopObservingPage(pageObserver)
            observedOwner = null
        }
        OnDestroy {
            pendingTextPromise?.resolve(null)
            pendingTextPromise = null
            observedOwner?.stopObserving(observer)
            observedOwner?.stopObservingDashboard(dashboardObserver)
            observedOwner?.stopObservingAction(actionObserver)
            observedOwner?.stopObservingPage(pageObserver)
            observedOwner = null
        }
        Function("getState") { owner.snapshot() }
        AsyncFunction("getPushToken") { promise: Promise ->
            val context = requireNotNull(appContext.reactContext)
            if (FirebaseApp.getApps(context).isEmpty()) {
                promise.resolve(null)
            } else {
                FirebaseMessaging.getInstance().token
                    .addOnSuccessListener { token -> promise.resolve(token) }
                    .addOnFailureListener { promise.reject("E_WEAR_PUSH", "Push token unavailable", null) }
            }
        }
        AsyncFunction("requestText") { label: String, promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null || pendingTextPromise != null) {
                promise.reject("E_WEAR_TEXT", "Watch text input is unavailable", null)
                return@AsyncFunction
            }
            val intent = Intent(activity, WearTextEntryActivity::class.java)
                .putExtra("label", label)
            pendingTextPromise = promise
            try {
                activity.startActivityForResult(intent, 7251)
            } catch (_: Exception) {
                pendingTextPromise = null
                promise.reject("E_WEAR_TEXT", "Watch text input is unavailable", null)
            }
        }.runOnQueue(Queues.MAIN)
        OnActivityResult { _, payload ->
            if (payload.requestCode == 7251) {
                val promise = pendingTextPromise
                pendingTextPromise = null
                val value = if (payload.resultCode == Activity.RESULT_OK)
                    payload.data?.getStringExtra("text")
                else null
                promise?.resolve(value)
            }
        }
        Function("isBackgroundRefreshActive") { runId: Int ->
            WearDashboardRefreshJobService.isActive(runId)
        }
        Function("completeBackgroundRefresh") { runId: Int ->
            WearDashboardRefreshJobService.complete(runId)
        }
        Function("setDirectPairingIdentity") { identity: String ->
            WearDashboardRefreshJobService.setDirectIdentity(requireNotNull(appContext.reactContext), identity)
        }
        Function("getDirectSnapshotSlot") {
            WearDashboardRefreshJobService.currentSlot(requireNotNull(appContext.reactContext))
        }
        Function("publishDirectSnapshotSlot") { runId: Int, identity: String, slot: Int ->
            WearDashboardRefreshJobService.publishSlot(requireNotNull(appContext.reactContext), runId, identity, slot)
        }
        AsyncFunction("discoverPeers") { promise: Promise ->
            val context = requireNotNull(appContext.reactContext)
            Wearable.getNodeClient(context).connectedNodes
                .addOnSuccessListener { nodes ->
                    nodes.forEach { owner.recover(it.id) }
                    promise.resolve(nodes.map { mapOf("id" to it.id, "displayName" to it.displayName, "nearby" to it.isNearby) })
                }
                .addOnFailureListener { promise.reject("E_WEAR_TRANSPORT", "Companion discovery is unavailable", null) }
        }
        AsyncFunction("beginEnrollment") { nodeId: String, promise: Promise ->
            owner.begin(nodeId) { complete(promise, it) }
        }
        AsyncFunction("confirmEnrollment") { fingerprint: String, promise: Promise ->
            owner.confirm(fingerprint) { complete(promise, it) }
        }
        AsyncFunction("retryEnrollment") { promise: Promise -> owner.retry { complete(promise, it) } }
        AsyncFunction("cancelEnrollment") { nodeId: String -> owner.cancel(nodeId) }
        AsyncFunction("reserveDashboardRevision") { bindingId: String, promise: Promise ->
            owner.reserveDashboardRevision(bindingId) { revision, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(requireNotNull(revision).toDouble())
            }
        }
        AsyncFunction("publishDashboard") { bindingId: String, publisherEpoch: String,
            revision: Double, expiresAt: Double, serialized: String, promise: Promise ->
            try {
                require(revision >= 0 && revision <= 9_007_199_254_740_991.0 && revision % 1.0 == 0.0)
                require(expiresAt >= 0 && expiresAt <= 9_007_199_254_740_991.0 && expiresAt % 1.0 == 0.0)
                val metadata = WearEnvelopeMetadata(bindingId, WearEnvelopeKind.DASHBOARD,
                    publisherEpoch, revision.toLong(), "dashboard", expiresAt.toLong())
                val bytes = serialized.toByteArray(Charsets.UTF_8)
                require(bytes.size <= 32768)
                owner.publishDashboard(metadata, bytes) { complete(promise, it) }
            } catch (error: Exception) { complete(promise, error) }
        }
        AsyncFunction("isDashboardPublished") { bindingId: String, publisherEpoch: String,
            revision: Double, promise: Promise ->
            try {
                require(revision >= 0 && revision <= 9_007_199_254_740_991.0 && revision % 1.0 == 0.0)
                owner.isDashboardPublished(bindingId, publisherEpoch, revision.toLong()) { published, error ->
                    if (error != null) complete(promise, error)
                    else promise.resolve(published)
                }
            } catch (error: Exception) { complete(promise, error) }
        }
        AsyncFunction("readDashboard") { bindingId: String, promise: Promise ->
            owner.readDashboard(bindingId) { result, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(result?.let {
                    mapOf("bindingId" to it.metadata.bindingId,
                        "publisherEpoch" to it.metadata.publisherEpoch,
                        "revision" to it.metadata.revision.toDouble(),
                        "expiresAt" to it.metadata.expiresAt.toDouble(),
                        "serialized" to String(it.plaintext, Charsets.UTF_8))
                })
            }
        }
        AsyncFunction("claimAction") { promise: Promise ->
            owner.claimAction { claim, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(claim)
            }
        }
        AsyncFunction("commitActionHandoff") { bindingId: String, requestId: String,
            actionHash: String, claimToken: String, canonical: String, promise: Promise ->
            owner.commitActionHandoff(bindingId, requestId, actionHash, claimToken, canonical) { outcome, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(outcome)
            }
        }
        AsyncFunction("journalAction") { bindingId: String, requestId: String, promise: Promise ->
            owner.journalAction(bindingId, requestId) { record, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(record?.let {
                    mapOf("bindingId" to it.bindingId, "requestId" to it.requestId,
                        "actionHash" to it.actionHash, "actionName" to it.actionName,
                        "state" to it.state, "expiresAt" to it.expiresAt.toDouble(),
                        "reason" to it.reason)
                })
            }
        }
        AsyncFunction("startActionEffect") { bindingId: String, requestId: String,
            actionHash: String, promise: Promise ->
            owner.startActionEffect(bindingId, requestId, actionHash) { started, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(started)
            }
        }
        AsyncFunction("finishActionEffect") { bindingId: String, requestId: String,
            actionHash: String, outcome: String, reason: String?, promise: Promise ->
            owner.finishActionEffect(bindingId, requestId, actionHash, outcome, reason) { finished, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(finished)
            }
        }
        AsyncFunction("sendJournalReceipt") { bindingId: String, requestId: String,
            promise: Promise ->
            owner.sendJournalReceipt(bindingId, requestId) { complete(promise, it) }
        }
        AsyncFunction("sendHostPage") { bindingId: String, requestId: String,
            serialized: String, promise: Promise ->
            owner.sendHostPage(bindingId, requestId, serialized) { complete(promise, it) }
        }
        AsyncFunction("sendUsagePage") { bindingId: String, requestId: String,
            serialized: String, promise: Promise ->
            owner.sendUsagePage(bindingId, requestId, serialized) { complete(promise, it) }
        }
        AsyncFunction("sendAgentPage") { bindingId: String, requestId: String,
            serialized: String, promise: Promise ->
            owner.sendAgentPage(bindingId, requestId, serialized) { complete(promise, it) }
        }
        AsyncFunction("sendConversationPage") { bindingId: String, requestId: String,
            serialized: String, promise: Promise ->
            owner.sendConversationPage(bindingId, requestId, serialized) { complete(promise, it) }
        }
        AsyncFunction("sendNotificationsPage") { bindingId: String, requestId: String,
            serialized: String, promise: Promise ->
            owner.sendNotificationsPage(bindingId, requestId, serialized) { complete(promise, it) }
        }
        AsyncFunction("readHostPage") { bindingId: String, requestId: String,
            promise: Promise ->
            owner.readHostPage(bindingId, requestId) { page, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(page?.let {
                    mapOf("bindingId" to it.bindingId, "requestId" to it.requestId,
                        "actionHash" to it.actionHash, "publisherEpoch" to it.publisherEpoch,
                        "revision" to it.revision.toDouble(),
                        "expiresAt" to it.expiresAt.toDouble(), "serialized" to it.serialized)
                })
            }
        }
        AsyncFunction("readUsagePage") { bindingId: String, requestId: String,
            promise: Promise ->
            owner.readUsagePage(bindingId, requestId) { page, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(page?.let {
                    mapOf("bindingId" to it.bindingId, "requestId" to it.requestId,
                        "actionHash" to it.actionHash, "publisherEpoch" to it.publisherEpoch,
                        "revision" to it.revision.toDouble(),
                        "expiresAt" to it.expiresAt.toDouble(), "serialized" to it.serialized)
                })
            }
        }
        AsyncFunction("readAgentPage") { bindingId: String, requestId: String,
            promise: Promise ->
            owner.readAgentPage(bindingId, requestId) { page, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(page?.let {
                    mapOf("bindingId" to it.bindingId, "requestId" to it.requestId,
                        "actionHash" to it.actionHash, "publisherEpoch" to it.publisherEpoch,
                        "revision" to it.revision.toDouble(),
                        "expiresAt" to it.expiresAt.toDouble(), "serialized" to it.serialized)
                })
            }
        }
        AsyncFunction("readConversationPage") { bindingId: String, requestId: String,
            promise: Promise ->
            owner.readConversationPage(bindingId, requestId) { page, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(page?.let {
                    mapOf("bindingId" to it.bindingId, "requestId" to it.requestId,
                        "actionHash" to it.actionHash, "publisherEpoch" to it.publisherEpoch,
                        "revision" to it.revision.toDouble(),
                        "expiresAt" to it.expiresAt.toDouble(), "serialized" to it.serialized)
                })
            }
        }
        AsyncFunction("readNotificationsPage") { bindingId: String, requestId: String,
            promise: Promise ->
            owner.readNotificationsPage(bindingId, requestId) { page, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(page?.let {
                    mapOf("bindingId" to it.bindingId, "requestId" to it.requestId,
                        "actionHash" to it.actionHash, "publisherEpoch" to it.publisherEpoch,
                        "revision" to it.revision.toDouble(),
                        "expiresAt" to it.expiresAt.toDouble(), "serialized" to it.serialized)
                })
            }
        }
        AsyncFunction("pendingJournalReceipts") { promise: Promise ->
            owner.pendingJournalReceipts { records, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(records)
            }
        }
        AsyncFunction("pendingJournalReconciliation") { promise: Promise ->
            owner.pendingJournalReconciliation { records, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(records)
            }
        }
        AsyncFunction("sendAction") { canonical: String, promise: Promise ->
            owner.sendAction(canonical) { outcome, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(outcome)
            }
        }
        AsyncFunction("readAction") { bindingId: String, requestId: String,
            promise: Promise ->
            owner.readAction(bindingId, requestId) { record, error ->
                if (error != null) complete(promise, error)
                else promise.resolve(record?.let {
                    mapOf("bindingId" to it.bindingId, "requestId" to it.requestId,
                        "actionHash" to it.actionHash, "status" to it.status,
                        "reason" to it.reason, "expiresAt" to it.expiresAt.toDouble())
                })
            }
        }
    }

    private fun complete(promise: Promise, error: Exception?) {
        if (error == null) promise.resolve(null)
        else promise.reject("E_WEAR_OPERATION", "Companion operation did not complete; inspect its state", null)
    }
}
