<?php

namespace App\Http\Controllers;

use App\Models\Contact;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * The People section's address books (People → Shared / Personal address book).
 *
 * One controller for both books: the Shared book is account-wide and every
 * staff member reads and writes it; a Personal book belongs to the caller
 * alone. The scope decides both, and {@see Contact::scopeVisibleTo()} is the
 * single place that is enforced, every route here resolves a record through
 * it, so a personal entry cannot be reached by guessing its id.
 */
class ContactsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $this->authorizeBooks($request);
        $scope = $this->scope($request);

        $contacts = Contact::query()
            ->visibleTo($user, $scope)
            ->orderByRaw('COALESCE(NULLIF(last_name, \'\'), first_name)')
            ->orderBy('first_name')
            ->get()
            // `canEdit` travels with the row so the list only offers the
            // actions this reader would actually be allowed to take.
            ->map(fn (Contact $c) => $c->toRecord() + ['canEdit' => $this->mayWrite($user, $c)])
            ->values();

        return response()->json([
            'scope' => $scope,
            'contacts' => $contacts,
            // The Shared book is a shared asset: everyone may add to it, but
            // only administrators may remove someone else's entry.
            'canManageShared' => Role::can($user, 'users.manage'),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $this->authorizeBooks($request);
        $scope = $this->scope($request);
        $data = $this->validated($request);

        $contact = Contact::create($data + [
            'uuid' => (string) Str::uuid(),
            'scope' => $scope,
            'owner_id' => $scope === Contact::SCOPE_PERSONAL ? $user->id : null,
            'created_by' => $user->id,
        ]);

        return response()->json(['contact' => $contact->toRecord()], 201);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $this->authorizeBooks($request);
        $contact = $this->find($request, $uuid);
        $this->authorizeWrite($user, $contact);

        $contact->fill($this->validated($request))->save();

        return response()->json(['contact' => $contact->fresh()->toRecord()]);
    }

    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $this->authorizeBooks($request);
        $contact = $this->find($request, $uuid);
        $this->authorizeWrite($user, $contact);

        $contact->delete();

        return response()->json(['status' => 'ok']);
    }

    /** Remove the checked rows, what the list's "Remove Selected" sends. */
    public function bulkDestroy(Request $request): JsonResponse
    {
        $user = $this->authorizeBooks($request);
        $scope = $this->scope($request);

        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['string'],
        ]);

        $contacts = Contact::query()
            ->visibleTo($user, $scope)
            ->whereIn('uuid', $data['ids'])
            ->get()
            ->filter(fn (Contact $c) => $this->mayWrite($user, $c));

        foreach ($contacts as $contact) {
            $contact->delete();
        }

        return response()->json(['deleted' => $contacts->count()]);
    }

    /**
     * Both books are staff tooling: the same capability the People section's
     * nav is pruned with, so the sidebar and the API agree.
     */
    private function authorizeBooks(Request $request): User
    {
        $user = $request->user();
        abort_unless(Role::can($user, 'directory.view'), 403, 'Only staff can use the address books.');

        return $user;
    }

    private function scope(Request $request): string
    {
        $scope = (string) $request->input('scope', Contact::SCOPE_PERSONAL);

        return in_array($scope, Contact::SCOPES, true) ? $scope : Contact::SCOPE_PERSONAL;
    }

    /** Resolve through the visible set, so a miss is a 404 rather than a 403. */
    private function find(Request $request, string $uuid): Contact
    {
        $user = $request->user();

        return Contact::query()
            ->where('uuid', $uuid)
            ->where(function ($q) use ($user) {
                $q->where('scope', Contact::SCOPE_SHARED)
                    ->orWhere(fn ($p) => $p->where('scope', Contact::SCOPE_PERSONAL)->where('owner_id', $user->id));
            })
            ->firstOrFail();
    }

    private function mayWrite(User $user, Contact $contact): bool
    {
        if ($contact->scope === Contact::SCOPE_PERSONAL) {
            return $contact->owner_id === $user->id;
        }

        // Shared: your own entry, or anyone's if you administer the account.
        return $contact->created_by === $user->id || Role::can($user, 'users.manage');
    }

    private function authorizeWrite(User $user, Contact $contact): void
    {
        abort_unless(
            $this->mayWrite($user, $contact),
            403,
            'Only the person who added this contact, or an administrator, can change it.'
        );
    }

    /**
     * The editable fields only. `scope` is deliberately not among them: which
     * book an entry lives in is decided on create and never moved by an edit.
     *
     * @return array<string, mixed>
     */
    private function validated(Request $request): array
    {
        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:100'],
            'last_name' => ['nullable', 'string', 'max:100'],
            'email' => ['nullable', 'string', 'email', 'max:255'],
            'company' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:64'],
            'job_title' => ['nullable', 'string', 'max:120'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'scope' => ['nullable', Rule::in(Contact::SCOPES)],
        ]);

        unset($data['scope']);

        return $data;
    }
}
