package com.tmantoinelaw.portal.core.data.cip

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Rows of `GET /portal/cip/applications` (app/Http/Controllers/Cip/CipApplicationController.php:767-810). */
@Serializable
data class ApplicationsPageDto(
    val applications: List<ApplicationDto> = emptyList(),
    val page: Int = 1,
    val lastPage: Int = 1,
    val perPage: Int = 50,
    val total: Int = 0,
    val statuses: List<OptionDto> = emptyList(),
    val personStatuses: List<OptionDto> = emptyList(),
    val assignees: List<AssigneeDto> = emptyList(),
    val providers: List<OptionDto> = emptyList(),
    val phaseCounts: Map<String, Int> = emptyMap(),
)

@Serializable
data class OptionDto(val value: String = "", val label: String = "", val tone: String? = null)

@Serializable
data class AssigneeDto(val id: Long? = null, val userId: Long? = null, val name: String = "", val email: String? = null, val avatar: String? = null, val accountType: String? = null, val role: String? = null, val roleLabel: String? = null, val assignedAt: String? = null, val first: String? = null, val roles: List<String> = emptyList())

@Serializable
data class AttentionDto(val comments: Int = 0, val mentionsMe: Int = 0, val messages: Int = 0)

@Serializable
data class DecisionLetterDto(val fileId: String? = null, val fileName: String? = null)

@Serializable
data class MilestoneDto(val key: String, val label: String = "", val date: String? = null, val reached: Boolean = false, val canEdit: Boolean = false, val canRecord: Boolean = false)

/** A slot on a person's checklist (CipApplicationController.php:1524-1668). */
@Serializable
data class SlotDto(
    val id: String,
    val type: String = "",
    val label: String = "",
    val required: Boolean = false,
    val help: String? = null,
    val carriedForward: Boolean = false,
    val uploaded: Boolean = false,
    val status: String = "pending_upload",
    val statusLabel: String = "",
    val statusTone: String? = null,
    val updateReason: String? = null,
    val canReview: Boolean = false,
    val canUpload: Boolean = false,
    val fileId: String? = null,
    val comments: Int = 0,
    val fileName: String? = null,
    val fileSize: String? = null,
    val fileExt: String? = null,
    val thumbUrl: String? = null,
    val previewUrl: String? = null,
    val downloadUrl: String? = null,
    val fileMime: String? = null,
    val fileCategory: String? = null,
)

@Serializable
data class PersonDto(
    val id: String,
    val role: String = "main_applicant",
    val label: String = "",
    val relationship: String? = null,
    val dependentOrdinal: Int? = null,
    val name: String = "",
    val firstName: String? = null,
    val lastName: String? = null,
    val gender: String? = null,
    val dateOfBirth: String? = null,
    val countryOfBirth: String? = null,
    val countryOfResidence: String? = null,
    val region: String? = null,
    val occupation: String? = null,
    val passportNumber: String? = null,
    val photo: String? = null,
    val passportPhotoUrl: String? = null,
    val applicantType: String? = null,
    val applicantTypeLabel: String? = null,
    val documents: List<SlotDto> = emptyList(),
    val outstanding: List<String> = emptyList(),
    val status: String? = null,
    val statusLabel: String? = null,
    val statusTone: String? = null,
    val availableStatuses: List<OptionDto> = emptyList(),
)

/** A row or a full application (the full record adds the people, milestones and dates). */
@Serializable
data class ApplicationDto(
    val id: String,
    val clientUid: String? = null,
    val attention: AttentionDto? = null,
    val number: String? = null,
    val internalNumber: String? = null,
    val cipNumber: String? = null,
    val submittedAt: String? = null,
    val photo: String? = null,
    val applicantName: String? = null,
    val provider: String? = null,
    val providerId: String? = null,
    val providerCode: String? = null,
    val contactPerson: String? = null,
    val contactEmail: String? = null,
    val investmentType: String? = null,
    val investmentTypeValue: String? = null,
    val investmentTypeOther: String? = null,
    val familySize: Int? = null,
    val familyLabel: String? = null,
    val status: String = "",
    val statusLabel: String = "",
    val statusTone: String? = null,
    val locked: Boolean = false,
    val lockedAt: String? = null,
    val corLocked: Boolean = false,
    val phase: String? = null,
    val phaseLabel: String? = null,
    val stageAction: JsonElement? = null,
    val availableTransitions: List<OptionDto> = emptyList(),
    val availableOverrides: List<OptionDto> = emptyList(),
    val assignedTo: List<AssigneeDto> = emptyList(),
    val assignedOfficer: AssigneeDto? = null,
    val familyMembers: List<PersonDto> = emptyList(),
    val queryReceivedAt: String? = null,
    val acceptedAt: String? = null,
    val decision: String? = null,
    val decidedAt: String? = null,
    val decisionLetter: DecisionLetterDto? = null,
    val postApprovalAt: String? = null,
    val canConfirm: Boolean = false,
    val additionalDocumentsFolder: String? = null,
    val sponsored: Boolean = false,
    val applicant: PersonDto? = null,
    val sponsor: PersonDto? = null,
    val dependents: List<PersonDto> = emptyList(),
    val milestones: List<MilestoneDto> = emptyList(),
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class ApplicationEnvelope(val application: ApplicationDto? = null, val client: ClientRecordDto? = null)

@Serializable
data class EventDto(val id: Long? = null, val action: String = "", val `when`: String? = null, val who: AssigneeDto? = null, val what: String = "")

@Serializable
data class EventsDto(val events: List<EventDto> = emptyList())

/** `Client::toRecord()` (app/Models/Client.php:145-212). `id` is the uid slug. */
@Serializable
data class ClientRecordDto(
    val id: String,
    val name: String = "",
    val initial: String? = null,
    val initialColor: String? = null,
    val photo: String? = null,
    val profile: JsonObject? = null,
    val folderUuid: String? = null,
    val hasLogin: Boolean = false,
    val userId: Long? = null,
    val companyId: String? = null,
    val companyName: String? = null,
    val clientType: String? = null,
    val clientTypeLabel: String? = null,
    val referralType: String? = null,
    val referredByCompanyId: String? = null,
    val referredByLabel: String? = null,
    val contact: String? = null,
)

@Serializable
data class ClientEnvelope(val client: ClientRecordDto)

@Serializable
data class ClientsDirectoryDto(val clients: List<ClientRecordDto> = emptyList(), val customFields: List<JsonObject> = emptyList())

/** `GET /portal/companies` rows (app/Models/Company.php:123-183). */
@Serializable
data class CompanyDto(
    val id: String,
    val name: String = "",
    val logoUrl: String? = null,
    val cipCode: String? = null,
    val companyType: String? = null,
    val companyTypeLabel: String? = null,
    val website: String? = null,
    val email: String? = null,
    val phone: String? = null,
    val status: String? = null,
    val notes: String? = null,
    val memberCount: Int = 0,
    val peopleCount: Int = 0,
    val referredCount: Int = 0,
    val people: List<CompanyPersonDto> = emptyList(),
)

@Serializable
data class CompanyPersonDto(val id: String, val name: String = "", val initial: String? = null, val initialColor: String? = null, val email: String? = null, val hasLogin: Boolean = false)

@Serializable
data class CompanyEnvelope(val company: CompanyDto)

@Serializable
data class CompaniesDto(val companies: List<CompanyDto> = emptyList())

@Serializable
data class CipDashboardEnvelope(val cip: Boolean = false, val buckets: List<JsonObject> = emptyList())

@Serializable
data class MessagesLaneDto(val id: String, val body: String = "", val lane: String = "internal", val laneLabel: String? = null, val author: AssigneeDto? = null, val mine: Boolean = false, val createdAt: String = "")

@Serializable
data class ThreadDto(val canPostInternal: Boolean = false, val lanes: List<String> = emptyList(), val messages: List<MessagesLaneDto> = emptyList())

/** `GET /portal/clients/{uid}/assignments` (ClientAssignmentController@index). */
@Serializable
data class AssignmentsDto(
    val assignments: List<AssignmentDto> = emptyList(),
    val history: List<AssignmentDto> = emptyList(),
    val assignable: List<AssigneeDto> = emptyList(),
    val roles: List<OptionDto> = emptyList(),
    val levels: List<String> = emptyList(),
)

@Serializable
data class AssignmentDto(
    val userId: Long? = null,
    val name: String? = null,
    val email: String? = null,
    val avatar: String? = null,
    val role: String? = null,
    val roleLabel: String? = null,
    val level: String? = null,
    val primary: Boolean = false,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val endedAt: String? = null,
    val assignedAt: String? = null,
    val assignedBy: String? = null,
)

/** `GET /portal/clients/{uid}/access` (ClientInviteController@access). */
@Serializable
data class AccessDto(
    val hasAccount: Boolean = false,
    val account: AccountDto? = null,
    val logins: List<LoginRowDto> = emptyList(),
    val activity: List<ActivityRowDto> = emptyList(),
    val invitation: JsonObject? = null,
    val canInvite: Boolean = false,
    val email: String? = null,
)

@Serializable
data class AccountDto(val name: String? = null, val email: String? = null, val avatar: String? = null, val accountType: String? = null, val status: String? = null, val twoFactor: Boolean = false, val onboardedAt: String? = null, val lastSeenAt: String? = null)

@Serializable
data class LoginRowDto(val event: String = "", val `when`: String? = null, val device: String? = null, val ip: String? = null)

@Serializable
data class ActivityRowDto(val type: String? = null, val description: String? = null, val `when`: String? = null)

/** `GET /portal/clients/{uid}/conversations` (ClientConversationController@index). */
@Serializable
data class ConversationsDto(val conversations: List<ConversationRowDto> = emptyList(), val options: JsonObject? = null, val recordings: List<JsonObject> = emptyList())

@Serializable
data class ConversationRowDto(
    val id: String,
    val title: String? = null,
    val subtitle: String? = null,
    val subject: String? = null,
    val unread: Int = 0,
    val preview: String? = null,
    val lastAt: String? = null,
    val avatar: String? = null,
)

@Serializable
data class BucketDto(val key: String, val label: String = "", val count: Int = 0, val tone: String? = null)

@Serializable
data class BucketsDto(val buckets: List<BucketDto> = emptyList())
