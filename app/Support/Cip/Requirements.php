<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The document checklist templates (§12), and putting them onto people.
 *
 * A template is a sentence about a kind of person, "every dependent under 16
 * owes a birth certificate". A slot, one `cip_documents` row, is that sentence
 * about one person, plus the file that answered it once there is one.
 * Materialising is the step between the two, and the only thing that opens or
 * closes a slot from a template.
 *
 * **Templates move forward, never backward.** A checklist already being worked
 * on gains whatever the templates have added since; it never loses an answer.
 * Withdrawing a requirement today does not unfile the passport somebody
 * scanned last week, that slot keeps its file, its version history and its
 * permissions, and merely stops being demanded. Only an *empty* slot for a
 * requirement that no longer applies is taken away, because an empty slot is a
 * question, and a question nobody is asking any more is noise on a reviewer's
 * screen and a false red mark on the applicant's.
 *
 * That one rule covers two things that look different and are not: a template
 * being retired, and a person moving out of the bracket that asked for it —
 * a dependant has a birthday mid-application, or a date of birth is corrected,
 * and they are suddenly a `dependent_16_over`. Both mean "this person no
 * longer owes this", and both are settled the same way.
 *
 * **Only while the application is open.** Once a file has gone to the Unit,
 * what was filed is what was filed; see {@see self::isOpen()}.
 */
class Requirements
{
    /** @var Collection<int, CipDocumentRequirement>|null */
    private static ?Collection $active = null;

    /** Drop the in-process catalogue. Template edits and tests must see the new rows. */
    public static function flush(): void
    {
        self::$active = null;
    }

    /**
     * Active templates, loaded once per process until {@see flush()}.
     *
     * @return Collection<int, CipDocumentRequirement>
     */
    private static function activeTemplates(): Collection
    {
        return self::$active ??= CipDocumentRequirement::query()->active()->get();
    }
    /**
     * The active templates for one applicant type, in the order they are
     * asked for, which is {@see CipDocumentRequirement::scopeActive()}'s
     * order, not a second opinion about it.
     *
     * @return Collection<int, CipDocumentRequirement>
     */
    public static function forType(string $applicantType): Collection
    {
        return self::forPhase($applicantType, Phase::PRE_APPROVAL);
    }

    /**
     * Active templates for one applicant type in a workflow lane.
     *
     * Pre-approval lists requirements flagged for that lane. Post-approval
     * lists post-only requirements plus any pre-approval row marked to carry
     * forward without re-uploading the file.
     *
     * @return Collection<int, CipDocumentRequirement>
     */
    public static function forPhase(string $applicantType, string $phase, ?CipApplication $application = null): Collection
    {
        $templates = self::activeTemplates()
            ->where('applicant_type', $applicantType)
            ->filter(function (CipDocumentRequirement $row) use ($phase) {
                if ($phase === Phase::POST_APPROVAL) {
                    return $row->at_post_approval
                        || ($row->at_pre_approval && $row->carry_forward);
                }

                return (bool) $row->at_pre_approval;
            })
            ->values();

        if ($application && $application->investment_type !== InvestmentType::REAL_ESTATE) {
            $templates = $templates->reject(fn (CipDocumentRequirement $row) => $row->real_estate_only);
        }

        return $templates->values();
    }

    /**
     * Open every slot this person's applicant type calls for, and close the
     * ones it no longer does.
     *
     * Idempotent, and cheap enough to call on every read: a run with nothing
     * to change writes nothing at all. That matters more than it looks, a
     * document slot touches its application, and the offline sync cursor asks
     * "which applications have moved since?" of `cip_applications.updated_at`.
     * A materialise that re-saved unchanged rows would report every open
     * application as moved every time anybody opened one.
     *
     * A person with no templates for their type gets an empty checklist. That
     * is an answer, not a failure: the templates are administrator-maintained
     * and a type nobody has written requirements for yet simply owes nothing.
     *
     * @return Collection<int, CipDocument> the whole checklist, re-read
     */
    public static function materialise(CipPerson $person): Collection
    {
        $person->loadMissing('application');

        if (! self::isOpen($person->application)) {
            return $person->documents()->get();
        }

        $phase = $person->application->phase ?? Phase::PRE_APPROVAL;
        $templates = self::forPhase(ApplicantType::for($person), $phase, $person->application);

        // One transaction: a half-applied template change would leave a
        // checklist that is neither the old one nor the new one, and the next
        // reviewer to open it would have no way of telling.
        DB::transaction(function () use ($person, $templates) {
            /*
             * The person's slots are read ONCE and handed down.
             *
             * openSlot used to look its own row up, which is a query per
             * template, and materialising an application runs it for every
             * person on it, so a family of six against seven requirements was
             * forty-two round trips to settle a checklist that had not
             * changed. One read, keyed by the slug the template is keyed on.
             */
            $existing = $person->documents()->get()->keyBy('type');

            foreach ($templates as $template) {
                self::openSlot($person, $template, $existing->get($template->key));
            }

            // Anything still pointing at a template outside that list is a
            // requirement this person has stopped owing. Slots with no
            // requirement_id are left alone, see {@see self::openSlot()}.
            $person->documents()
                ->whereNotNull('requirement_id')
                ->whereNotIn('requirement_id', $templates->pluck('id')->all())
                ->get()
                ->each(fn (CipDocument $slot) => self::withdraw($slot));
        });

        // Re-read rather than handing back what was just built: the row the
        // database holds carries the column defaults, a new slot's
        // `pending_upload` status among them, and the caller is entitled to
        // the checklist as it actually stands.
        return $person->documents()->get();
    }

    /**
     * Settle every checklist on one application.
     *
     * The application is handed to each person rather than looked up again:
     * a dependant's bracket is decided against the application's created_at,
     * so a family of five would otherwise fetch the same row five times.
     */
    public static function materialiseApplication(CipApplication $application): void
    {
        $application->loadMissing('people');

        foreach ($application->people as $person) {
            $person->setRelation('application', $application);
            self::materialise($person);
        }
    }

    /**
     * Withdraw a template.
     *
     * Both the flag and the soft delete: `active` is what a listing filters
     * on, and the row staying addressable is what lets a filled slot still say
     * what it was for. The template row itself is never hard-deleted, filled
     * slots hold a foreign key to it, and what was asked at the time is part
     * of the record of how the application was handled.
     *
     * The checklists are settled in the same transaction, so a requirement is
     * never withdrawn from the templates while still being demanded of people.
     */
    public static function retire(CipDocumentRequirement $requirement): CipDocumentRequirement
    {
        return DB::transaction(function () use ($requirement) {
            $requirement->forceFill(['active' => false])->save();
            $requirement->delete();

            self::settle($requirement);

            return $requirement;
        });
    }

    /**
     * Put a retired template back, and re-open the slots it had.
     *
     * There is nothing to undelete: the empty slots were removed outright, not
     * parked, so who owes this has to be worked out from the templates again.
     * That is the sweep below, and it deliberately runs the same call every
     * other path runs, bringing one requirement back also settles whatever
     * else the templates have changed in the meantime, which is what this
     * class promises everywhere else rather than a special case here.
     */
    public static function restore(CipDocumentRequirement $requirement): CipDocumentRequirement
    {
        return DB::transaction(function () use ($requirement) {
            $requirement->restore();
            $requirement->forceFill(['active' => true])->save();

            self::resettleOpenApplications();

            return $requirement;
        });
    }

    /**
     * This person's slot for one template, created if it is not there, and
     * brought into line with the template if it is.
     *
     * `status` is never written from here. It belongs to the review
     * conversation (§12), not to the template: re-wording a label must not
     * throw a document in Update required back to Pending upload.
     */
    private static function openSlot(
        CipPerson $person,
        CipDocumentRequirement $template,
        ?CipDocument $slot = null,
    ): void {
        // Handed in by the caller, which read them all at once. Looked up here
        // only when somebody calls this with one template in hand.
        $slot ??= CipDocument::query()
            ->where('person_id', $person->id)
            ->where('type', $template->key)
            ->first();

        if (! $slot) {
            (new CipDocument)->forceFill([
                'application_id' => $person->application_id,
                'person_id' => $person->id,
                'type' => $template->key,
                'requirement_id' => $template->id,
                'label' => $template->label,
                'required' => (bool) $template->required,
            ])->save();

            return;
        }

        $changed = [];

        /*
         * The link is adopted whatever state the slot is in. An intake slot
         * ({@see DocumentSlots::open()}) predates this table and carries no
         * requirement_id at all, and finding it by the same slug the template
         * is keyed on is what lets the passport bio page somebody uploaded on
         * day one go on answering the same question.
         *
         * Cast on both sides before comparing: PDO hands bigint columns back
         * as strings on Postgres and as integers on SQLite, so a strict
         * comparison would find a difference on every run under Postgres and
         * re-save a row nothing had touched, the exact churn this method is
         * written to avoid.
         */
        if ((int) $slot->requirement_id !== (int) $template->id) {
            $changed['requirement_id'] = $template->id;
        }

        /*
         * The wording is not adopted so freely. {@see CipDocument::requirement()}
         * keeps `label` on the slot precisely so a requirement reworded in
         * March does not restate what was filed in January. So an answered
         * slot keeps the words it was answered under, and only one still
         * waiting is brought up to date, a question that is still being asked
         * ought to be asked in the words the firm uses now.
         */
        if (! $slot->isFilled()) {
            if ($slot->label !== $template->label) {
                $changed['label'] = $template->label;
            }

            if ((bool) $slot->required !== (bool) $template->required) {
                $changed['required'] = (bool) $template->required;
            }
        }

        if ($changed !== []) {
            $slot->forceFill($changed)->save();
        }
    }

    /**
     * A slot for something this person no longer owes.
     *
     * Filled, it stays. The file was uploaded in good faith, it is a real
     * document in the library with its own history and permissions, and a
     * checklist that deleted answers whenever the questions changed would lose
     * work nobody agreed to lose. It stops being required instead, which is
     * what takes it off {@see DocumentSlots::outstanding()} while leaving it
     * on the file.
     *
     * Empty, it goes, and goes properly, rather than into the soft-deleted
     * tail. `cip_documents` carries a plain unique index on (person_id, type)
     * that counts trashed rows, so a tombstone there would make the slot
     * impossible to re-open if the requirement ever came back.
     */
    private static function withdraw(CipDocument $slot): void
    {
        if (! $slot->isFilled()) {
            $slot->forceDelete();

            return;
        }

        if ($slot->required) {
            $slot->forceFill(['required' => false])->save();
        }
    }

    /**
     * Take a retired requirement off the checklists that still carry it.
     *
     * Chunked rather than loaded whole, this walks every checklist in the
     * module, and chunked by id specifically, because the walk deletes rows
     * and an offset-paged one would step straight over whatever moved up.
     */
    private static function settle(CipDocumentRequirement $requirement): void
    {
        CipDocument::query()
            ->where('requirement_id', $requirement->id)
            ->with('application')
            ->chunkById(200, function (Collection $slots) {
                foreach ($slots as $slot) {
                    if (self::isOpen($slot->application)) {
                        self::withdraw($slot);
                    }
                }
            });
    }

    /**
     * Re-materialise every application still open.
     *
     * Broad by nature and rare by design: templates are edited by an
     * administrator now and then, not by the caseload. Chunked so a module
     * holding thousands of live applications settles them a page at a time
     * instead of loading the lot into memory.
     */
    private static function resettleOpenApplications(): void
    {
        CipApplication::query()
            ->whereNull('locked_at')
            ->whereNotIn('status', Status::TERMINAL)
            ->with('people')
            ->chunkById(50, function (Collection $applications) {
                foreach ($applications as $application) {
                    self::materialiseApplication($application);
                }
            });
    }

    /**
     * A checklist changes only while its application can.
     *
     * Once a file has gone to the Unit, adding a question to it or taking one
     * away would rewrite a record somebody else is holding a copy of, so the
     * submission lock closes the checklist along with everything else. A
     * decided application is the same argument after the fact: what it asked
     * for is part of the history of how it was decided.
     */
    private static function isOpen(?CipApplication $application): bool
    {
        if ($application === null || $application->isLocked()) {
            return false;
        }

        if ($application->phase === Phase::POST_APPROVAL) {
            return true;
        }

        return ! Status::isTerminal($application->status);
    }
}
