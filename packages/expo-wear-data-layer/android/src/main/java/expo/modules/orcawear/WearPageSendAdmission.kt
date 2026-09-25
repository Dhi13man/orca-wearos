package expo.modules.orcawear

internal fun admitsPageSend(metadata: WearEnvelopeMetadata,
    published: PublishedWearDashboard?, action: WearJournalRecord?,
    expectedAction: String, now: Long): Boolean =
    published?.publisherEpoch == metadata.publisherEpoch &&
        published.revision == metadata.revision &&
        published.expiresAt > now && metadata.expiresAt > now &&
        action?.bindingId == metadata.bindingId &&
        action.requestId == metadata.requestId &&
        action.actionName == expectedAction &&
        action.state == "effect_started" &&
        action.expiresAt > now
