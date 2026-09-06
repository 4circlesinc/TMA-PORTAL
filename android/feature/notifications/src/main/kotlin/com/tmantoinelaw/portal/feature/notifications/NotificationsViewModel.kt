package com.tmantoinelaw.portal.feature.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tmantoinelaw.portal.core.data.notifications.NotificationDto
import com.tmantoinelaw.portal.core.data.notifications.NotificationsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class NotificationFilter { All, Unread, ActionRequired }

data class NotificationsUi(
    val items: List<NotificationDto> = emptyList(),
    val unread: Int = 0,
    val filter: NotificationFilter = NotificationFilter.All,
    val loaded: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
    val hasMore: Boolean = false,
)

@HiltViewModel
class NotificationsViewModel @Inject constructor(
    private val repository: NotificationsRepository,
) : ViewModel() {
    private val filter = MutableStateFlow(NotificationFilter.All)
    private val loading = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)

    val ui: StateFlow<NotificationsUi> = combine(repository.items, repository.unread, filter, repository.loaded, loading, error) { values ->
        @Suppress("UNCHECKED_CAST")
        val items = values[0] as List<NotificationDto>
        val f = values[2] as NotificationFilter
        NotificationsUi(
            items = when (f) {
                NotificationFilter.All -> items
                NotificationFilter.Unread -> items.filter { !it.read }
                NotificationFilter.ActionRequired -> items.filter { it.requiresAction && !it.completed }
            },
            unread = values[1] as Int,
            filter = f,
            loaded = values[3] as Boolean,
            loading = values[4] as Boolean,
            error = values[5] as String?,
            hasMore = repository.hasMore,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), NotificationsUi())

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            loading.value = true
            val result = repository.loadFirstPage(
                unreadOnly = filter.value == NotificationFilter.Unread,
                actionRequired = filter.value == NotificationFilter.ActionRequired,
            )
            error.value = if (result.isFailure && repository.items.value.isEmpty()) FAILED else null
            loading.value = false
        }
    }

    fun setFilter(f: NotificationFilter) {
        if (filter.value == f) return
        filter.value = f
        refresh()
    }

    fun loadMore() {
        viewModelScope.launch {
            repository.loadMore(filter.value == NotificationFilter.Unread, filter.value == NotificationFilter.ActionRequired)
        }
    }

    fun open(item: NotificationDto) { if (!item.read) viewModelScope.launch { repository.markRead(item.id) } }
    fun markRead(id: String) = viewModelScope.launch { repository.markRead(id) }
    fun markUnread(id: String) = viewModelScope.launch { repository.markUnread(id) }
    fun complete(id: String) = viewModelScope.launch { repository.complete(id) }
    fun delete(id: String) = viewModelScope.launch { repository.delete(id) }
    fun readAll() = viewModelScope.launch { repository.readAll() }

    companion object { const val FAILED = "Could not load notifications." }
}
