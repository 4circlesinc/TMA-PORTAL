<?php

namespace App\Support\Cip;

/**
 * The open drop box every person on every application carries.
 *
 * The seeded checklists name the papers the firm knows to ask for. A file
 * always arrives with one they did not — a guardianship order, a translator's
 * note, the letter an officer asked for over the phone — and until this
 * existed there was nowhere on the person to put it. The paper went into the
 * client-level drawer, where it stopped saying whose it was, or it did not go
 * up at all.
 *
 * So: one optional requirement, seeded for all five applicant types and ticked
 * on all three lanes, filed into an Additional Documents drawer inside that
 * person's own folder.
 *
 * It is deliberately NOT the Add-On G-series. Those are three numbered slots
 * that take one paper each and rename it `G{n} - {paper}`, because the Add-On
 * brief prescribes that convention and a reviewer reads the number. This box
 * is unbounded and keeps every filename as it was uploaded: what goes in here
 * is by definition the paper nobody wrote a rule for, so inventing a name for
 * it would only bury the one the sender chose.
 *
 * @see AddOnRequirements for the G1–G3 slots, which stay exactly as they were.
 */
class AdditionalDocuments
{
    /**
     * The requirement key. Shared by all five applicant types, which is safe
     * because `cip_document_requirements` is unique on (applicant_type, key)
     * and a slot is unique on (person_id, type) — one box per person.
     */
    public const KEY = 'additional_documents';

    public const LABEL = 'Additional documents';

    public const HELP = 'Anything else this person is filing; each file keeps its own name.';

    /**
     * Never required: the box exists for papers no checklist predicted, so an
     * empty one must never be what holds a family back from submission.
     */
    public static function row(): array
    {
        return [
            'key' => self::KEY,
            'label' => self::LABEL,
            'required' => false,
            'help' => self::HELP,
            'folder' => Tree::ADDITIONAL,
            'at_pre_approval' => true,
            'at_post_approval' => true,
            'at_add_on' => true,
            'carry_forward' => false,
        ];
    }

    public static function is(?string $key): bool
    {
        return $key === self::KEY;
    }

    /**
     * Where this box sits in the checklist: after every paper the firm names,
     * and below the post-approval packs, so it never pushes a required row
     * down the page.
     */
    public const SORT_ORDER = 900;
}
