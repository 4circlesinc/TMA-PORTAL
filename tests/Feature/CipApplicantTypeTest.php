<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\Dependents;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * Which of the five checklists a person owes (§12).
 *
 * Every requirement anyone is shown hangs off this answer, so the cases worth
 * pinning are the ones where it could quietly come out wrong: the spouse who
 * would otherwise be sorted by age, the single day either side of the cutoff,
 * and the dependant whose date of birth nobody supplied.
 */
class CipApplicantTypeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    /**
     * An application, optionally opened on a given day.
     *
     * The day matters: it is the date every age is measured against, so a test
     * that cannot backdate it can only ever assert about today.
     */
    private function application(?Carbon $openedAt = null): CipApplication
    {
        $creator = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::EMPLOYEE,
            'email_verified_at' => now(),
        ]);

        $application = Applications::create(
            CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']),
            $creator,
        );

        if ($openedAt !== null) {
            $application->forceFill(['created_at' => $openedAt])->save();
        }

        return $application->fresh();
    }

    private function person(
        CipApplication $application,
        string $role,
        ?string $relationship = null,
        ?string $dateOfBirth = null,
    ): CipPerson {
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => $role,
            'relationship' => $relationship,
            'first_name' => 'Test',
            'last_name' => 'Person',
            'date_of_birth' => $dateOfBirth,
        ]);

        // Read back, so the classification is made from what the database
        // actually holds rather than from the strings this test typed.
        return $person->fresh();
    }

    public function test_each_role_maps_to_its_applicant_type(): void
    {
        $application = $this->application();

        $this->assertSame(ApplicantType::PRINCIPAL_APPLICANT, ApplicantType::for(
            $this->person($application, CipPerson::ROLE_MAIN_APPLICANT, null, '1985-04-12'),
        ));

        $this->assertSame(ApplicantType::SPONSOR, ApplicantType::for(
            $this->person($application, CipPerson::ROLE_SPONSOR, null, '1960-02-02'),
        ));

        $this->assertSame(ApplicantType::DEPENDENT_UNDER_16, ApplicantType::for(
            $this->person($application, CipPerson::ROLE_DEPENDENT, CipPerson::RELATIONSHIP_QUALIFIED,
                now()->subYears(8)->toDateString()),
        ));

        $this->assertSame(ApplicantType::DEPENDENT_16_OVER, ApplicantType::for(
            $this->person($application, CipPerson::ROLE_DEPENDENT, CipPerson::RELATIONSHIP_QUALIFIED,
                now()->subYears(20)->toDateString()),
        ));
    }

    /**
     * A spouse is filed as a spouse whatever year they were born.
     *
     * They are a dependant by relationship, so an age rule applied to every
     * dependant would sort a young spouse into a child's checklist — and the
     * folder tree would still be calling them Spouse while it happened.
     */
    public function test_a_spouse_is_a_spouse_and_never_an_age_bracket(): void
    {
        $application = $this->application();

        $spouse = $this->person($application, CipPerson::ROLE_DEPENDENT,
            CipPerson::RELATIONSHIP_SPOUSE, '1990-01-01');
        $this->assertSame(ApplicantType::SPOUSE, ApplicantType::for($spouse));
        $this->assertSame('Spouse', Dependents::label($spouse), 'the two rules must agree');

        // A spouse young enough to be a child by age alone is still a spouse.
        $young = $this->person($application, CipPerson::ROLE_DEPENDENT,
            CipPerson::RELATIONSHIP_SPOUSE, now()->subYears(15)->toDateString());
        $this->assertSame(ApplicantType::SPOUSE, ApplicantType::for($young));

        // A relationship that did not come from the intake form — an import
        // writes whatever the source system called it — reads the same way.
        $imported = $this->person($application, CipPerson::ROLE_DEPENDENT,
            'Spouse of Applicant', now()->subYears(15)->toDateString());
        $this->assertSame(ApplicantType::SPOUSE, ApplicantType::for($imported));
    }

    public function test_a_dependant_one_day_short_of_the_cutoff_is_still_under_16(): void
    {
        $openedAt = now()->subMonths(6)->startOfDay();
        $application = $this->application($openedAt);

        // Their sixteenth birthday is the day after the file was opened.
        $child = $this->person($application, CipPerson::ROLE_DEPENDENT, CipPerson::RELATIONSHIP_QUALIFIED,
            $openedAt->copy()->subYears(16)->addDay()->toDateString());

        $this->assertSame(ApplicantType::DEPENDENT_UNDER_16, ApplicantType::for($child));
    }

    public function test_a_dependant_one_day_past_the_cutoff_is_16_or_over(): void
    {
        $openedAt = now()->subMonths(6)->startOfDay();
        $application = $this->application($openedAt);

        $child = $this->person($application, CipPerson::ROLE_DEPENDENT, CipPerson::RELATIONSHIP_QUALIFIED,
            $openedAt->copy()->subYears(16)->subDay()->toDateString());
        $this->assertSame(ApplicantType::DEPENDENT_16_OVER, ApplicantType::for($child));

        // ...and on the birthday itself they are sixteen, not turning sixteen.
        $onTheDay = $this->person($application, CipPerson::ROLE_DEPENDENT, CipPerson::RELATIONSHIP_QUALIFIED,
            $openedAt->copy()->subYears(16)->toDateString());
        $this->assertSame(ApplicantType::DEPENDENT_16_OVER, ApplicantType::for($onTheDay));
    }

    /**
     * The bracket is fixed on the day the application was opened.
     *
     * Measuring against today would mean a child's checklist growing a line
     * mid-application because they had a birthday, with nothing in the file to
     * explain where the new requirement came from.
     */
    public function test_the_bracket_is_measured_at_the_application_date_not_today(): void
    {
        $openedAt = now()->subYears(3)->startOfDay();
        $application = $this->application($openedAt);

        // Fifteen when the file was opened, eighteen by now.
        $child = $this->person($application, CipPerson::ROLE_DEPENDENT, CipPerson::RELATIONSHIP_QUALIFIED,
            $openedAt->copy()->subYears(15)->toDateString());

        $this->assertSame(ApplicantType::DEPENDENT_UNDER_16, ApplicantType::for($child));
    }

    /**
     * No date of birth means the older bracket — the safe answer.
     *
     * That is the bracket which asks more of a person. Being asked for a
     * document that turns out to be unnecessary is a question a reviewer can
     * waive; quietly not asking files the application short, and nobody finds
     * that out until the government does.
     */
    public function test_a_dependant_with_no_date_of_birth_is_read_as_16_or_over(): void
    {
        $application = $this->application();

        $unknown = $this->person($application, CipPerson::ROLE_DEPENDENT, CipPerson::RELATIONSHIP_QUALIFIED);

        $this->assertNull($unknown->date_of_birth);
        $this->assertSame(ApplicantType::DEPENDENT_16_OVER, ApplicantType::for($unknown));
    }

    public function test_the_cutoff_and_the_words_around_it_follow_the_firms_setting(): void
    {
        config(['cip.dependent_age_cutoff' => 18]);
        $this->assertSame(18, ApplicantType::cutoff());

        $openedAt = now()->subMonths(6)->startOfDay();
        $application = $this->application($openedAt);

        // Seventeen: over the default boundary, under this firm's.
        $child = $this->person($application, CipPerson::ROLE_DEPENDENT, CipPerson::RELATIONSHIP_QUALIFIED,
            $openedAt->copy()->subYears(17)->toDateString());
        $this->assertSame(ApplicantType::DEPENDENT_UNDER_16, ApplicantType::for($child));

        // The keys are frozen, so a heading that still said 16 would be the
        // portal telling a reviewer something the firm does not believe.
        $this->assertSame('Dependent under 18', ApplicantType::label(ApplicantType::DEPENDENT_UNDER_16));
        $this->assertSame('Dependent 18 and over', ApplicantType::label(ApplicantType::DEPENDENT_16_OVER));
    }

    public function test_the_five_types_are_the_whole_vocabulary(): void
    {
        $this->assertSame([
            ApplicantType::PRINCIPAL_APPLICANT,
            ApplicantType::SPOUSE,
            ApplicantType::DEPENDENT_UNDER_16,
            ApplicantType::DEPENDENT_16_OVER,
            ApplicantType::SPONSOR,
        ], ApplicantType::ALL);

        $this->assertSame(ApplicantType::ALL, array_keys(ApplicantType::all()));
        $this->assertSame([
            'Principal applicant', 'Spouse', 'Dependent under 16',
            'Dependent 16 and over', 'Sponsor',
        ], array_values(ApplicantType::all()));

        $this->assertTrue(ApplicantType::isValid(ApplicantType::SPONSOR));
        $this->assertFalse(ApplicantType::isValid('qualified_dependent'));
        $this->assertFalse(ApplicantType::isValid('main_applicant'));

        // An unrecognised type shows itself rather than disappearing from a
        // heading and leaving a checklist nobody can name.
        $this->assertSame('nonsense', ApplicantType::label('nonsense'));
    }
}
