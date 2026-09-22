package com.ferrotune.feature.player.data

import com.ferrotune.core.network.dto.MoveInQueueRequest
import com.ferrotune.core.network.dto.RepeatModeRequest
import com.ferrotune.core.network.dto.ShuffleRequest
import com.ferrotune.core.network.generated.GetQueueResponse
import com.ferrotune.core.network.generated.QueueSuccessResponse
import com.ferrotune.core.testing.FakeFerrotuneApi

internal class FakeQueueApi : FakeFerrotuneApi() {
    var queueParams: Map<String, String>? = null
    var queueHandler: (suspend (Map<String, String>) -> GetQueueResponse)? = null
    var removedPosition: Long? = null
    var removeParams: Map<String, String>? = null
    var cleared = false
    var moveRequest: MoveInQueueRequest? = null
    var shuffleRequest: ShuffleRequest? = null
    var repeatRequest: RepeatModeRequest? = null

    override suspend fun queue(params: Map<String, String>): GetQueueResponse {
        queueParams = params
        queueHandler?.let { return it(params) }
        val offset = params["offset"]?.toInt() ?: 0
        return testQueueResponse(currentIndex = offset, offset = offset)
    }

    override suspend fun removeFromQueue(
        position: Long,
        params: Map<String, String>,
    ): QueueSuccessResponse {
        removedPosition = position
        removeParams = params
        return QueueSuccessResponse(success = true)
    }

    override suspend fun clearQueue(params: Map<String, String>): QueueSuccessResponse {
        cleared = true
        return QueueSuccessResponse(success = true)
    }

    override suspend fun moveInQueue(request: MoveInQueueRequest): QueueSuccessResponse {
        moveRequest = request
        return QueueSuccessResponse(success = true)
    }

    override suspend fun toggleQueueShuffle(request: ShuffleRequest): QueueSuccessResponse {
        shuffleRequest = request
        return QueueSuccessResponse(success = true)
    }

    override suspend fun setQueueRepeatMode(request: RepeatModeRequest): QueueSuccessResponse {
        repeatRequest = request
        return QueueSuccessResponse(success = true)
    }
}
