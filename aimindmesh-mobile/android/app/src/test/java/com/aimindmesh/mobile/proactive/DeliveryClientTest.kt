package com.aimindmesh.mobile.proactive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeliveryClientTest {
    private val ready = ServerConfig(
        enabled = true, serverUrl = "http://10.2.0.1:3030", deliveryMode = "CONTEXTUAL",
        deviceId = "abc123", apiKey = "key",
    )

    @Test
    fun pollsOnlyWhenEverythingIsInPlace() {
        assertTrue(DeliveryClient.shouldPoll(ready, 80, notificationsAllowed = true))
    }

    @Test
    fun neverPollsWithoutNotificationPermission() {
        // The server marks items delivered when it returns them: they would be lost
        assertFalse(DeliveryClient.shouldPoll(ready, 100, notificationsAllowed = false))
    }

    @Test
    fun respectsModeAvailabilityAndConfig() {
        assertFalse(DeliveryClient.shouldPoll(ready.copy(deliveryMode = "PUSH"), 100, true))
        assertFalse(DeliveryClient.shouldPoll(ready, DeliveryClient.AVAILABILITY_THRESHOLD - 1, true))
        assertFalse(DeliveryClient.shouldPoll(ready.copy(enabled = false), 100, true))
        assertFalse(DeliveryClient.shouldPoll(ready.copy(apiKey = ""), 100, true))
        assertFalse(DeliveryClient.shouldPoll(ready.copy(deviceId = ""), 100, true))
        assertFalse(DeliveryClient.shouldPoll(ready.copy(serverUrl = " "), 100, true))
    }

    @Test
    fun parsesTheRealServerResponse() {
        val body = """{"items":[
            {"id":"p1","insightId":"i1","deviceId":"abc123","createdAt":1,"content":"Solar panels and batteries"},
            {"id":"p2","insightId":"i2","deviceId":"abc123","createdAt":2,"content":null},
            {"insightId":"no-id"}
        ],"count":3}"""
        assertEquals(
            listOf(
                PendingInsight("p1", "i1", "Solar panels and batteries"),
                PendingInsight("p2", "i2", null),
            ),
            DeliveryClient.parsePending(body),
        )
    }

    @Test
    fun toleratesAnEmptyOrOldResponse() {
        assertEquals(emptyList<PendingInsight>(), DeliveryClient.parsePending("""{"count":0}"""))
        assertEquals(emptyList<PendingInsight>(), DeliveryClient.parsePending("""{"items":[],"count":0}"""))
    }

    @Test
    fun neverPollsInQuietHours() {
        assertFalse(DeliveryClient.shouldPoll(ready, 100, notificationsAllowed = true, quietHours = true))
    }

    @Test
    fun sumsUpABurstOfInsights() {
        val items = (1..5).map { PendingInsight("p$it", "i$it", "insight $it") }
        val (shown, more) = DeliveryClient.planNotifications(items)
        assertEquals(listOf("p1", "p2", "p3"), shown.map { it.id })
        assertEquals(2, more)
        assertEquals(0, DeliveryClient.planNotifications(items.take(2)).second)
    }
}
