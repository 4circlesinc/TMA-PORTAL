<?php

namespace App\Http\Controllers;

use App\Models\ClientAssignment;
use App\Models\OnboardingProgress;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\AvatarService;
use App\Support\Notifications\Notifier;
use App\Support\Onboarding\AccountSetupFlow;
use App\Support\Onboarding\ClientFlow;
use App\Support\Onboarding\ClientProfile;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * The guided onboarding a client walks through after accepting their invitation.
 *
 * One screen per topic, answers saved as each is submitted, so closing the tab
 * on step 4 comes back to step 4. Nothing here can be reached once onboarding
 * is finished. {@see self::progress()} sends a completed account to the portal
 * instead, which is what stops the back button reopening the wizard.
 */
class ClientOnboardingController extends Controller
{
    /** Land on whichever step they have got to. */
    public function index(Request $request): RedirectResponse
    {
        $progress = $this->progress($request->user());

        return redirect()->route('onboarding.show', ['step' => ClientFlow::nextUnfinished($progress)]);
    }

    public function show(Request $request, string $step): View|RedirectResponse
    {
        $user = $request->user();
        $progress = $this->progress($user);

        $requested = $step;
        $step = ClientFlow::resolve($step) ?? $step;

        if (! ClientFlow::exists($step)) {
            return redirect()->route('onboarding.index');
        }

        if ($requested !== $step) {
            return redirect()->route('onboarding.show', ['step' => $step]);
        }

        return view('onboarding.client', $this->viewData($user, $progress, $step));
    }

    public function store(Request $request, string $step): RedirectResponse
    {
        $user = $request->user();
        $progress = $this->progress($user);

        $step = ClientFlow::resolve($step) ?? $step;

        if (! ClientFlow::exists($step) || ! ClientFlow::applies($step, $progress)) {
            return redirect()->route('onboarding.index');
        }

        $values = $request->validate(
            ClientFlow::rules($step),
            ClientFlow::messages($step),
        );

        if ($step === 'you') {
            if ($request->hasFile('photo')) {
                $user->forceFill([
                    'avatar_url' => AvatarService::storeUploaded($request->file('photo'), $user->avatar_url),
                ])->save();
            }
            unset($values['photo']);
            $values['uploaded'] = $user->fresh()->avatar_url !== null;
        }

        if ($step === 'work') {
            $values['contacts'] = array_values(array_filter(
                $values['contacts'] ?? [],
                fn ($row) => ! empty($row['name']) || ! empty($row['email']),
            ));
        }

        $progress->remember($step, $values);

        // Applied step by step as well as on completion, so someone who stops
        // half way still has the details they gave on their record.
        ClientProfile::apply($user->fresh(), $progress);

        $next = ClientFlow::after($step, $progress->fresh());

        if ($next === null) {
            return $this->finish($request, $user);
        }

        $progress->forceFill(['current_step' => $next])->save();

        return redirect()->route('onboarding.show', ['step' => $next]);
    }

    /** Finish: mark it done, tell the assigned staff, and go to the portal. */
    public function complete(Request $request): RedirectResponse
    {
        return $this->finish($request, $request->user());
    }

    private function finish(Request $request, User $user): RedirectResponse
    {
        $progress = $this->progress($user);

        // Every required step has to be answered, the wizard enforces this by
        // ordering, but the route is still a public POST.
        if ($progress->isComplete()) {
            AccountSetupFlow::begin($user);

            return redirect()->route('account-setup.show', [
                'step' => AccountSetupFlow::firstStep($user->fresh()),
            ]);
        }

        foreach (ClientFlow::applicableSteps($progress) as $step) {
            if (! ClientFlow::isOptional($step) && ! ClientFlow::hasFinished($progress, $step)) {
                return redirect()->route('onboarding.show', ['step' => $step])
                    ->withErrors(['step' => 'Please finish this step first.']);
            }
        }

        ClientProfile::apply($user->fresh(), $progress);

        $progress->forceFill([
            'completed_at' => now(),
            'current_step' => 'done',
        ])->save();

        $user->forceFill([
            // The wizard collects everything profile-setup would have asked
            // for, so a client who finishes here is not sent round again.
            'profile_completed_at' => $user->profile_completed_at ?? now(),
        ])->save();

        AccountSetupFlow::markAccountsPhaseComplete($user);
        AccountSetupFlow::begin($user->fresh());

        $this->announce($user);

        return redirect()->route('account-setup.show', [
            'step' => AccountSetupFlow::firstStep($user->fresh()),
        ]);
    }

    /** Tell the staff who look after this client that they are set up. */
    private function announce(User $user): void
    {
        $client = ClientProfile::for($user);

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'client.account_activity',
            'description' => $user->name.' completed onboarding',
            'subject' => $user,
            'client' => $client,
            'metadata' => ['flow' => 'client'],
        ]);

        if (! $client) {
            return;
        }

        $staff = ClientAssignment::where('client_id', $client->id)
            ->with('user')->get()->pluck('user')->filter();

        foreach ($staff as $member) {
            Notifier::send([
                'user' => $member,
                'actor' => $user,
                'type' => 'client.account_activity',
                'title' => $user->name.' finished setting up their account',
                'message' => 'Their profile on '.$client->name.' is now up to date.',
                'subject' => $client,
                'client' => $client,
                'action_url' => '/clients?client='.$client->uid,
            ]);
        }
    }

    /** Go back a step without losing anything. */
    public function back(Request $request, string $step): RedirectResponse
    {
        $progress = $this->progress($request->user());
        $step = ClientFlow::resolve($step) ?? $step;
        $previous = ClientFlow::before($step, $progress);

        return redirect()->route('onboarding.show', [
            'step' => $previous ?? ClientFlow::stepKeys()[0],
        ]);
    }

    /** @return array<string, mixed> */
    private function viewData(User $user, OnboardingProgress $progress, string $step): array
    {
        $position = ClientFlow::position($step, $progress);
        $client = ClientProfile::for($user);

        return [
            'user' => $user,
            'client' => $client,
            'progress' => $progress,
            'step' => $step,
            'title' => ClientFlow::title($step),
            'values' => ClientFlow::defaults($step, $user, $progress),
            'index' => $position['index'],
            'total' => $position['total'],
            'steps' => ClientFlow::applicableSteps($progress),
            'previous' => ClientFlow::before($step, $progress),
            'optional' => ClientFlow::isOptional($step),
            'contactMethods' => ClientFlow::CONTACT_METHODS,
            'calendarAvailable' => ClientFlow::calendarAvailable(),
            'google' => $user->connectedAccount('google'),
            'microsoft' => $user->connectedAccount('microsoft'),
            'assignedStaff' => $client
                ? ClientAssignment::where('client_id', $client->id)->with('user')->get()
                : collect(),
        ];
    }

    /**
     * This person's progress row, created on first sight. Redirects out
     * entirely if they have no business being here.
     */
    private function progress(User $user): OnboardingProgress
    {
        return OnboardingProgress::firstOrCreate(
            ['user_id' => $user->id],
            [
                'flow' => Role::isClient($user)
                    ? OnboardingProgress::FLOW_CLIENT
                    : OnboardingProgress::FLOW_STAFF,
                'current_step' => ClientFlow::stepKeys()[0],
                'completed_steps' => [],
                'answers' => [],
                'started_at' => now(),
            ],
        );
    }
}
