// Generated from action-manifest.json; run pnpm generate.
package dev.orca.wear.contract

internal data class ActionSchema(val target: Map<String, List<String>>, val payload: Map<String, List<String>>, val sessionFenced: Boolean)
internal object ActionManifest {
    const val schemaVersion = 1
    const val actionBytes = 8192
    const val payloadBytes = 4096
    const val idBytes = 256
    const val messageBytes = 2048
    val envelopeOrder = listOf("schemaVersion", "bindingId", "requestId", "expiresAt", "action", "target", "publisherEpoch", "expectedRevision", "targetPublicationEpoch", "targetSnapshotVersion", "payload")
    val actions = mapOf(
        "readHostPage" to ActionSchema(linkedMapOf<String, List<String>>(), linkedMapOf<String, List<String>>("cursor" to listOf("nullableId")), false),
        "readUsagePage" to ActionSchema(linkedMapOf<String, List<String>>(), linkedMapOf<String, List<String>>("cursor" to listOf("nullableId")), false),
        "readHostAgents" to ActionSchema(linkedMapOf<String, List<String>>("hostId" to listOf("id")), linkedMapOf<String, List<String>>("cursor" to listOf("nullableId")), false),
        "readNotificationsPage" to ActionSchema(linkedMapOf<String, List<String>>(), linkedMapOf<String, List<String>>("cursor" to listOf("nullableId")), false),
        "openConversation" to ActionSchema(linkedMapOf<String, List<String>>("hostId" to listOf("id"), "workspaceId" to listOf("id"), "workspaceKind" to listOf("worktree", "folder"), "sessionTabId" to listOf("id")), linkedMapOf<String, List<String>>(), true),
        "renewConversation" to ActionSchema(linkedMapOf<String, List<String>>("hostId" to listOf("id"), "workspaceId" to listOf("id"), "workspaceKind" to listOf("worktree", "folder"), "sessionTabId" to listOf("id")), linkedMapOf<String, List<String>>("leaseId" to listOf("id")), true),
        "closeConversation" to ActionSchema(linkedMapOf<String, List<String>>("hostId" to listOf("id"), "workspaceId" to listOf("id"), "workspaceKind" to listOf("worktree", "folder"), "sessionTabId" to listOf("id")), linkedMapOf<String, List<String>>("leaseId" to listOf("id")), true),
        "sendAgentMessage" to ActionSchema(linkedMapOf<String, List<String>>("hostId" to listOf("id"), "workspaceId" to listOf("id"), "workspaceKind" to listOf("worktree", "folder"), "sessionTabId" to listOf("id")), linkedMapOf<String, List<String>>("text" to listOf("message")), true),
        "requestPhoneHandoff" to ActionSchema(linkedMapOf<String, List<String>>("hostId" to listOf("id"), "workspaceId" to listOf("id"), "workspaceKind" to listOf("worktree", "folder"), "sessionTabId" to listOf("id")), linkedMapOf<String, List<String>>(), true),
        "refresh" to ActionSchema(linkedMapOf<String, List<String>>(), linkedMapOf<String, List<String>>(), false)
    )
}
