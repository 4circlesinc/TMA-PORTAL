<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipProvider;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Creating applications, and numbering them. One place so the invariant
 * cannot be skipped: an application, its internal number and its first audit
 * row are born in one transaction, a row without a number, or a number
 * without a row, cannot exist even for a moment.
 *
 * Family files mint [Code][YY]-[Sequence]. Add-On files mint
 * [Code]-AO-[YY]-[Sequence] when `$attributes['phase']` is {@see Phase::ADD_ON}.
 * Phase is not fillable, so it is read here before the model is constructed
 * and set on the row before the counter advances — setting it after create
 * would leave an Add-On wearing a family number.
 *
 * THE NUMBER IS GENERATED, NEVER TYPED
 *
 * Nobody enters an internal number. It is minted here when the row is
 * created, and minted again under the new firm's code when the application's
 * service provider changes ({@see numberUnder}, called by
 * {@see ProviderTransfer::rehome}). The Unit's CIP number is the one a
 * reader records and corrects, through {@see Submission}.
 */
class Applications
{
    /**
     * @param  string  $status  Where the application is born. NEW for a filing;
     *                          DRAFT for one the intake wizard is still being
     *                          typed into, which becomes NEW when it is filed.
     */
    public static function create(
        CipProvider $provider,
        User $creator,
        array $attributes = [],
        string $status = Status::NEW,
    ): CipApplication {
        return DB::transaction(function () use ($provider, $creator, $attributes, $status) {
            $phase = $attributes['phase'] ?? null;
            unset($attributes['phase']);

            $application = new CipApplication($attributes);
            $application->status = $status;
            $application->provider_id = $provider->id;
            $application->created_by = $creator->id;

            $addOn = $phase === Phase::ADD_ON;
            if ($addOn) {
                $application->phase = Phase::ADD_ON;
            }

            $application->internal_number = self::mint(
                $provider,
                $addOn ? Numbering::LANE_ADD_ON : Numbering::LANE_APPLICATION,
            );
            $application->save();

            Engine::record($application, CipEvent::ACTION_CREATED, $creator, [
                'internalNumber' => $application->internal_number,
            ]);

            return $application;
        });
    }

    /**
     * The number this application wears once it belongs to `$to`.
     *
     * A number already in that firm's own shape is kept: a file coming home
     * with the number it left under, or one that never matched the firm it
     * was sitting with. The firm's counter is moved past it so the next
     * filing cannot be minted onto it. Anything else is replaced by the
     * firm's next free number, in the application's own lane.
     *
     * The year is the file's own, not today's. YY says when the application
     * was opened, which is what it said before the move; only the firm's
     * code and the sequence change with the firm.
     *
     * Answers the number and writes nothing to the application: the caller
     * saves it in the same write as the firm, so the row is never seen under
     * one firm wearing the other's number. Advances a counter, so it must run
     * inside the caller's transaction ({@see Numbering} refuses otherwise),
     * and the caller must hold the row's lock.
     */
    public static function numberUnder(CipApplication $application, CipProvider $to): string
    {
        $current = (string) $application->internal_number;

        if ($current !== '' && Numbering::matches($to, $current)) {
            Numbering::reserve($to, $current);

            return $current;
        }

        return self::mint(
            $to,
            $application->isAddOn() ? Numbering::LANE_ADD_ON : Numbering::LANE_APPLICATION,
            $application->created_at,
            $application->id,
        );
    }

    /**
     * What {@see numberUnder} would answer, without spending anything.
     *
     * The form shows it the moment a reader picks another firm, so the
     * number is seen to follow the firm rather than appearing after a save.
     * It is the same walk, read-only: this file's own number when that firm
     * is the one it is with or the number is already in that firm's shape,
     * otherwise the first number past the counter that nobody wears. A
     * preview, not a reservation. The save mints for real under the
     * counter's lock, and on the rare day somebody files under that firm in
     * between, the save's number is the next one along.
     *
     * `$addOn` is for a form with no application behind it yet.
     */
    public static function preview(CipProvider $to, ?CipApplication $application = null, bool $addOn = false): string
    {
        if ($application !== null) {
            $current = (string) $application->internal_number;

            if ($current !== '' && (
                (int) $application->provider_id === (int) $to->id || Numbering::matches($to, $current)
            )) {
                return $current;
            }

            $addOn = $application->isAddOn();
        }

        $lane = $addOn ? Numbering::LANE_ADD_ON : Numbering::LANE_APPLICATION;
        $ahead = 0;

        do {
            $number = Numbering::peek($to, $application?->created_at, $lane, ++$ahead);
        } while (self::worn($number, $application?->id));

        return $number;
    }

    /**
     * The firm's next number that no application wears.
     *
     * The counter is not the only author of numbers. A file that arrives
     * from another firm keeps a number it already wore in this firm's shape,
     * numbers were typed by hand for one day in October 2026, and a firm's
     * code can be taken over by another register row. Any of those can sit
     * ahead of the counter, and a mint that trusted it would die on the
     * unique index, roll the counter back, and die the same way on every
     * filing under that firm afterwards. Stepping over a worn number burns
     * it, which is what moves the counter past the obstacle for good.
     *
     * Checked before the write rather than caught after it: on Postgres a
     * unique violation aborts the surrounding transaction, so there is no
     * retrying from inside the one the caller is holding.
     */
    private static function mint(
        CipProvider $provider,
        string $lane,
        ?CarbonInterface $when = null,
        ?int $except = null,
    ): string {
        do {
            $number = Numbering::next($provider, $when, $lane);
        } while (self::worn($number, $except));

        return $number;
    }

    /** Does any application, the recycle bin included, wear this number? */
    private static function worn(string $number, ?int $except = null): bool
    {
        return CipApplication::withTrashed()
            ->where('internal_number', $number)
            ->when($except !== null, fn (Builder $q) => $q->where('id', '!=', $except))
            ->exists();
    }

    /**
     * Applications that used to wear a number starting with this term.
     *
     * A number that changed with the firm is still the one printed on every
     * letter, invoice and email sent before the move, so a search has to go
     * on finding the file by it. The audit trail is where a retired number
     * lives ({@see ProviderTransfer::rehome} writes it), and only two actions
     * ever carry one, so this reads those rows rather than keeping a second
     * record of the same fact.
     *
     * A subquery of application ids, for `whereIn`. Anchored at the start,
     * like every other number search. Numbers are stored in capitals.
     */
    public static function previouslyNumbered(string $term): Builder
    {
        $prefix = mb_strtoupper(addcslashes(trim($term), '\\%_')).'%';

        return CipEvent::query()
            ->whereIn('action', [CipEvent::ACTION_PROVIDER_TRANSFERRED, CipEvent::ACTION_RENUMBERED])
            ->where('meta->previousInternalNumber', 'like', $prefix)
            ->select('application_id');
    }
}
