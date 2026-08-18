<?php

namespace App\Models;

use App\Support\Cip\DocumentStatus;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * One document slot: a requirement against a person, and the file that
 * answers it once there is one.
 *
 * The slot outlives its file. Emptying one leaves the requirement standing,
 * which is what makes a checklist a checklist rather than a list of whatever
 * happens to have been uploaded.
 */
// `status` and `status_changed_at` are deliberately out: a slot's status is a
// reviewer's verdict, it may only travel the legal edges, and the code that
// moves it stamps the date in the same breath. Mass-assignment from a request
// would let an upload declare itself ready for submission.
#[Fillable([
    'uuid', 'application_id', 'person_id', 'requirement_id', 'type', 'label',
    'required', 'file_id', 'uploaded_by', 'uploaded_at',
])]
class CipDocument extends Model
{
    use SoftDeletes;

    /**
     * A checklist slot filling in moves the application it belongs to.
     *
     * Same reason as CipPerson: the sync cursor reads the application's
     * timestamp, and a passport scan arriving is exactly the kind of change
     * a colleague's screen must notice. A document is reached through its
     * person, so this is the second half of that chain.
     */
    protected $touches = ['application'];

    protected static function booted(): void
    {
        static::creating(function (self $slot) {
            $slot->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'required' => 'boolean',
            'uploaded_at' => 'datetime',
            'status_changed_at' => 'datetime',
        ];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CipApplication::class, 'application_id');
    }

    public function person(): BelongsTo
    {
        return $this->belongsTo(CipPerson::class, 'person_id');
    }

    /**
     * The file answering this slot.
     *
     * `withTrashed()` lets the reviewer still see the file row in the viewer
     * even if it has been soft-deleted (they may want to restore it).  The
     * `isFilled()` helper uses the resolved model rather than the raw foreign
     * key so that a slot pointing at a deleted file reads as empty.
     */
    public function file(): BelongsTo
    {
        return $this->belongsTo(FileItem::class, 'file_id')->withTrashed();
    }

    /**
     * The checklist line this slot stands for.
     *
     * Null on the intake slots that predate the requirements table, which
     * carry their `type` slug instead. That is also why `label` is stored on
     * the slot rather than read through here: a slot has to be able to say
     * what it is asking for whether or not a requirement row exists, and a
     * requirement that is later reworded does not rewrite documents already
     * filed under the old wording.
     */
    public function requirement(): BelongsTo
    {
        return $this->belongsTo(CipDocumentRequirement::class, 'requirement_id');
    }

    /**
     * Review notes on this slot. {@see CipDocumentComment} says why they hang
     * off the slot rather than off the file.
     */
    public function comments(): HasMany
    {
        return $this->hasMany(CipDocumentComment::class, 'document_id');
    }

    /**
     * Whether this slot has a live (non-deleted) file answering it.
     *
     * A slot can have a `file_id` pointing at a soft-deleted row when the
     * observer hasn't run yet (e.g. in unit tests) or when a restore is
     * pending. Checking the resolved relation is more reliable than the raw key.
     */
    public function isFilled(): bool
    {
        if ($this->file_id === null) {
            return false;
        }

        if ($this->relationLoaded('file')) {
            return $this->file !== null && $this->file->deleted_at === null;
        }

        return FileItem::whereKey($this->file_id)->whereNull('deleted_at')->exists();
    }

    /**
     * The status the checklist should show right now.
     *
     * A slot with no live file is always Pending upload, even if the row still
     * says Application review from before the file was removed.
     */
    public function displayStatus(): string
    {
        if (! $this->isFilled()) {
            return DocumentStatus::PENDING_UPLOAD;
        }

        return $this->status ?? DocumentStatus::PENDING_UPLOAD;
    }
}
