package com.tmantoinelaw.portal.core.data.overview

import com.tmantoinelaw.portal.core.data.dashboard.FileRowDto
import com.tmantoinelaw.portal.core.data.dashboard.FilesListingDto
import com.tmantoinelaw.portal.core.data.dashboard.MetricsDto
import com.tmantoinelaw.portal.core.data.dashboard.Tile
import com.tmantoinelaw.portal.core.data.realtime.RealtimeCoordinator
import com.tmantoinelaw.portal.core.data.session.SessionRepository
import com.tmantoinelaw.portal.core.data.store.SnapshotStore
import com.tmantoinelaw.portal.core.network.api.PortalException
import com.tmantoinelaw.portal.core.network.api.PortalHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** `GET /portal/sign-ins?limit=` rows (app/Http/Controllers/SignInActivityController.php). */
@Serializable
data class SignInDto(
    val id: String,
    val module: String = "security",
    val type: String = "",
    val status: String = "success",
    val description: String = "",
    val actor: SignInActorDto? = null,
    val createdAt: String = "",
)

@Serializable
data class SignInActorDto(val id: Long? = null, val name: String? = null, val avatar: String? = null)

@Serializable
data class SignInsDto(val items: List<SignInDto> = emptyList())

data class OverviewState(
    val metrics: Tile<MetricsDto> = Tile(),
    val files: Tile<List<FileRowDto>> = Tile(),
    val signIns: Tile<List<SignInDto>> = Tile(),
)

/** The Overview page's own panels (public/js/overview.js); the road shares the Dashboard's. */
@Singleton
class OverviewRepository @Inject constructor(
    private val http: PortalHttp,
    private val snapshots: SnapshotStore,
    private val session: SessionRepository,
    private val realtime: RealtimeCoordinator,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow(OverviewState())
    val state: StateFlow<OverviewState> = _state.asStateFlow()

    init {
        session.identity.onEach { if (it == null) _state.value = OverviewState() else hydrate() }.launchIn(scope)
        realtime.dataChanged.onEach { if (it == "files") refreshFiles(); if (it == "activity") refreshSignIns() }.launchIn(scope)
    }

    private suspend fun hydrate() {
        _state.update { s ->
            s.copy(
                metrics = snapshots.read("overview:metrics", Tile.serializer(MetricsDto.serializer())) ?: s.metrics,
                files = snapshots.read("overview:files", Tile.serializer(ListSerializer(FileRowDto.serializer()))) ?: s.files,
                signIns = snapshots.read("overview:signins", Tile.serializer(ListSerializer(SignInDto.serializer()))) ?: s.signIns,
            )
        }
    }

    suspend fun refreshAll() {
        val identity = session.identity.value ?: return
        coroutineScope {
            listOf(async { refreshMetrics() }, async { refreshFiles() }, async { if (!identity.isProviderContact) refreshSignIns() }).forEach { it.await() }
        }
    }

    suspend fun refreshMetrics() = load("overview:metrics", MetricsDto.serializer(), { http.get("/portal/dashboard/metrics", MetricsDto.serializer()) }) { s, t -> s.copy(metrics = t) }

    suspend fun refreshFiles() = load("overview:files", ListSerializer(FileRowDto.serializer()), {
        http.get("/portal/files?section=recent&perPage=8&only=files&lean=1", FilesListingDto.serializer()).files.take(6)
    }) { s, t -> s.copy(files = t) }

    suspend fun refreshSignIns() = load("overview:signins", ListSerializer(SignInDto.serializer()), {
        http.get("/portal/sign-ins?limit=8", SignInsDto.serializer()).items
    }) { s, t -> s.copy(signIns = t) }

    private suspend fun <T> load(key: String, serializer: KSerializer<T>, fetch: suspend () -> T, apply: (OverviewState, Tile<T>) -> OverviewState) {
        val tile: Tile<T> = try {
            Tile(data = fetch(), real = true, loadedAt = System.currentTimeMillis())
        } catch (e: PortalException) {
            if (e.status == 403 || e.status == 404) Tile(data = null, real = true, loadedAt = System.currentTimeMillis())
            else Tile(data = null, real = false, loadedAt = System.currentTimeMillis())
        } catch (e: IOException) {
            Tile(data = null, real = false, loadedAt = System.currentTimeMillis())
        }
        _state.update { s -> if (!tile.real && tile.data == null) apply(s, current<T>(s, key).copy(loadedAt = tile.loadedAt)) else apply(s, tile) }
        if (tile.real) snapshots.write(key, tile, Tile.serializer(serializer))
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> current(s: OverviewState, key: String): Tile<T> = when (key) {
        "overview:metrics" -> s.metrics; "overview:files" -> s.files; else -> s.signIns
    } as Tile<T>
}
