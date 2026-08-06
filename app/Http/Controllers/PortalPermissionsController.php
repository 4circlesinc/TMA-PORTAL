<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\User;
use App\Support\Access\PortalPermissions;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Account settings > Advanced Preferences > Permissions.
 *
 * Two firm-wide defaults: whether employees see the People directory, and
 * whether client accounts may share files onward. Reading is open to anyone
 * who may open the section; writing is administrators only — the same split
 * ClientHubSettingsController uses, and for the same reason.
 */
class PortalPermissionsController extends Controller
{
    /**
     * The managed capability, with the plain-English label and the
     * consequence of switching it off. A toggle whose effect is described
     * only in the JS is a toggle nobody can audit.
     */
    private const CAPABILITY_COPY = [
        'directory.view' => [
            'label' => 'Show the People directory to employees',
            'help' => 'The People section: colleagues, the shared address book and groups. Off, only administrators can browse it. Clients never see it either way.',
        ],
    ];

    public function show(Request $request): JsonResponse
    {
        Role::authorize($request->user(), 'settings.advanced');

        $settings = PortalPermissions::all();

        return response()->json([
            // Reading and writing are different rights: an employee handed the
            // section can see the defaults without being able to move them.
            'canEdit' => Role::isAdmin($request->user()),
            'capabilities' => array_map(
                fn (string $capability) => [
                    'id' => $capability,
                    'label' => self::CAPABILITY_COPY[$capability]['label'],
                    'help' => self::CAPABILITY_COPY[$capability]['help'],
                    'granted' => $settings['employee'][$capability],
                    'default' => Role::baselineGrantsFor(PortalPermissions::MANAGED)[$capability],
                ],
                PortalPermissions::MANAGED,
            ),
            'clientSharing' => $settings['clientSharing'],
            // Who the two settings actually apply to, so the screen can say
            // "12 employees" rather than leaving it abstract.
            'counts' => [
                'employees' => User::query()->where('account_type', Role::EMPLOYEE)->count(),
                'clients' => Client::query()->count(),
            ],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        Role::authorize($request->user(), 'settings.advanced');
        abort_unless(Role::isAdmin($request->user()), 403, 'Only administrators can change these permissions.');

        $rules = ['clientSharing' => ['required', 'boolean'], 'employee' => ['required', 'array']];

        foreach (PortalPermissions::MANAGED as $capability) {
            // Capability names contain dots and validation keys read dots as
            // nesting, so each one has to be escaped or `directory.view` is
            // looked for at employee[directory][view] and never found.
            $rules['employee.'.str_replace('.', '\\.', $capability)] = ['required', 'boolean'];
        }

        $request->validate($rules);

        $before = PortalPermissions::all();

        // Read off the request rather than validated(): the escaped keys do
        // not survive it intact, and put() sanitises what it keeps anyway.
        PortalPermissions::put([
            'employee' => (array) $request->input('employee', []),
            'clientSharing' => $request->boolean('clientSharing'),
        ], $request->user()->id);

        $this->logChanges($request->user(), $before, PortalPermissions::all());

        return response()->json(['status' => 'ok'] + $this->show($request)->getData(true));
    }

    /**
     * Record what moved. Both settings widen or narrow who can reach what, and
     * "it was always like that" is not an answer the activity trail should
     * have to give months later.
     */
    private function logChanges(User $actor, array $before, array $after): void
    {
        $changes = [];

        foreach (PortalPermissions::MANAGED as $capability) {
            if ($before['employee'][$capability] !== $after['employee'][$capability]) {
                $changes[] = ($after['employee'][$capability] ? 'granted' : 'revoked')
                    .' "'.self::CAPABILITY_COPY[$capability]['label'].'"';
            }
        }

        if ($before['clientSharing'] !== $after['clientSharing']) {
            $changes[] = $after['clientSharing']
                ? 'allowed clients to share files onward'
                : 'stopped clients sharing files onward';
        }

        if ($changes === []) {
            return;
        }

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'settings.permissions-updated',
            'module' => 'settings',
            'description' => $actor->name.' '.implode('; ', $changes),
            'old' => $before,
            'new' => $after,
        ]);
    }
}
