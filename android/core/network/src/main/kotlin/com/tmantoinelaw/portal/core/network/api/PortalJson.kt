package com.tmantoinelaw.portal.core.network.api

import kotlinx.serialization.json.Json

/** Tolerant on purpose: the portal adds keys freely and the app must not break when it does. */
val PortalJson: Json = Json {
    ignoreUnknownKeys = true
    isLenient = true
    explicitNulls = false
    coerceInputValues = true
}
