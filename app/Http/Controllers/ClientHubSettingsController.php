<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Clients\ClientHubSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Account settings > Client hub management > Client hub access.
 *
 * The firm-wide shape of the client hub: which of its capabilities employees
 * hold, and how client invitations behave. Reading is open to anyone who may
 * open the section; writing is administrators only, exactly like the security
 * policies, see AdminSecurityController, whose shape this follows.
 */
class ClientHubSettingsController extends Controller
{
    /**
     * Each managed capability, in the order the screen lists them, with the
     * plain-English label and the consequence of switching it off. The screen
     * has no business inventing these, an access toggle whose effect is
     * described only in the JS is a toggle nobody can audit.
     */
    private const CAPABILITY_COPY = [
        'clients.view' => [
            'label' => 'Open the client hub',
            'help' => 'Without this the Clients page and everything under it disappears for employees.',
        ],
        'clients.viewAll' => [
            'label' => 'See every client, not just their own',
            'help' => 'Off, an employee sees only the clients they hold a live assignment on.',
        ],
        'clients.manage' => [
            'label' => 'Create, edit and delete client records',
            'help' => 'Off, employees can read the hub but not change it.',
        ],
        'clients.invite' => [
            'label' => 'Invite clients to the portal',
            'help' => 'Controls who may send a client the link that creates their account.',
        ],
        'clients.assign' => [
            'label' => 'Assign staff to clients',
            'help' => 'Assignments drive folder access, so this hands out file access too.',
        ],
    ];

    public function show(Request $request): JsonResponse
    {
        Role::authorize($request->user(), 'settings.clientHub');

        $settings = ClientHubSettings::all();

        return response()->json([
            // Reading and writing are different rights here: an employee who
            // was handed the section can see how the hub is shaped without
            // being able to re-shape it.
            'canEdit' => Role::isAdmin($request->user()),
            'capabilities' => array_map(
                fn (string $capability) => [
                    'id' => $capability,
                    'label' => self::CAPABILITY_COPY[$capability]['label'],
                    'help' => self::CAPABILITY_COPY[$capability]['help'],
                    'granted' => $settings['employee'][$capability],
                    'default' => Role::baselineEmployeeGrants()[$capability],
                ],
                ClientHubSettings::MANAGED,
            ),
            'allowSelfRegistration' => $settings['allowSelfRegistration'],
            'inviteExpiryDays' => $settings['inviteExpiryDays'],
            'expiryChoices' => ClientHubSettings::EXPIRY_CHOICES,
            // What the toggles are actually deciding for, so the screen can
            // say "12 employees" rather than leaving it abstract.
            'counts' => $this->counts(),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        Role::authorize($request->user(), 'settings.clientHub');
        abort_unless(Role::isAdmin($request->user()), 403, 'Only administrators can change client hub access.');

        $rules = [
            'allowSelfRegistration' => ['required', 'boolean'],
            'inviteExpiryDays' => ['required', 'integer', Rule::in(ClientHubSettings::EXPIRY_CHOICES)],
            'employee' => ['required', 'array'],
        ];

        foreach (ClientHubSettings::MANAGED as $capability) {
            // Capability names contain dots and validation keys read dots as
            // nesting, so each one has to be escaped or `clients.view` is
            // looked for at employee[clients][view] and never found.
            $rules['employee.'.str_replace('.', '\\.', $capability)] = ['required', 'boolean'];
        }

        $request->validate($rules);

        // Read back off the request rather than validated(): the escaped keys
        // do not survive it intact, and put() sanitises what it keeps anyway.
        $value = [
            'employee' => (array) $request->input('employee', []),
            'allowSelfRegistration' => $request->boolean('allowSelfRegistration'),
            'inviteExpiryDays' => (int) $request->input('inviteExpiryDays'),
        ];

        $before = ClientHubSettings::all();

        ClientHubSettings::put($value, $request->user()->id);

        $this->logChanges($request->user(), $before, ClientHubSettings::all());

        return response()->json(['status' => 'ok'] + $this->show($request)->getData(true));
    }

    /**
     * Who and what the settings apply to. Employees are the only role the
     * capability toggles can move, so they are the number worth showing.
     */
    private function counts(): array
    {
        return [
            'employees' => User::query()->whereIn('account_type', Role::EMPLOYEE_LIKE)->count(),
            'clients' => Client::query()->count(),
            'pendingInvitations' => Invitation::query()
                ->whereIn('type', [Invitation::TYPE_CLIENT, Invitation::TYPE_COMPANY_MEMBER])
                ->whereIn('status', Invitation::LIVE_STATUSES)
                ->whereNull('accepted_at')
                ->whereNull('cancelled_at')
                ->count(),
        ];
    }

    /**
     * Record what moved. Access grants are the kind of change somebody asks
     * about months later, and "it was always like that" is not an answer the
     * activity trail should have to give.
     */
    private function logChanges(User $actor, array $before, array $after): void
    {
        $changes = [];

        foreach (ClientHubSettings::MANAGED as $capability) {
            if ($before['employee'][$capability] !== $after['employee'][$capability]) {
                $changes[] = ($after['employee'][$capability] ? 'granted' : 'revoked')
                    .' "'.self::CAPABILITY_COPY[$capability]['label'].'" for employees';
            }
        }

        if ($before['allowSelfRegistration'] !== $after['allowSelfRegistration']) {
            $changes[] = $after['allowSelfRegistration']
                ? 'allowed clients to create their own account from an invitation'
                : 'stopped clients creating their own account from an invitation';
        }

        if ($before['inviteExpiryDays'] !== $after['inviteExpiryDays']) {
            $changes[] = 'set client invitation links to expire after '.$after['inviteExpiryDays'].' days';
        }

        if ($changes === []) {
            return;
        }

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'client.access-updated',
            'module' => 'clients',
            'description' => $actor->name.' '.implode('; ', $changes),
            'old' => $before,
            'new' => $after,
        ]);
    }
}
