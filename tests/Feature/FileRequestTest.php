<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\FileItem;
use App\Models\FileRequest;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Request Files, end to end.
 *
 * The public half of this is the only place in the portal where somebody with
 * no account writes bytes, so most of what is asserted here is what a visitor
 * must *not* be able to do: choose a destination, exceed a limit, upload past
 * an expiry, or get in without the password.
 */
class FileRequestTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-req-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config([
            'filesystems.disks.local.root' => $this->vaultRoot,
            'filesystems.files_disk' => 'local',
        ]);
        Mail::fake();
    }

    protected function tearDown(): void
    {
        $this->rrmdir($this->vaultRoot);
        parent::tearDown();
    }

    private function staff(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    private function folderFor(User $user, string $name = 'Intake'): Folder
    {
        $res = $this->actingAs($user)->postJson('/portal/files/folders', ['name' => $name]);
        $res->assertCreated();

        return Folder::where('uuid', $res->json('id'))->firstOrFail();
    }

    /**
     * Post a file the way the upload page does.
     *
     * With `Accept: application/json` — without it Laravel answers a failed
     * validation with a 302 back to the form, which is not what the page's
     * fetch() would ever see.
     */
    private function upload(string $token, UploadedFile $file, array $extra = [])
    {
        return $this->post('/r/'.$token.'/upload', array_merge(['file' => $file], $extra), [
            'Accept' => 'application/json',
            'X-Requested-With' => 'XMLHttpRequest',
        ]);
    }

    private function create(User $user, array $payload = []): array
    {
        $res = $this->actingAs($user)->postJson('/portal/files/requests', array_merge([
            'title' => 'Please upload your passport',
        ], $payload));
        $res->assertCreated();

        return $res->json('request');
    }

    /** The token never leaves the creator's own response. */
    public function test_created_request_returns_a_link_and_hides_the_token(): void
    {
        $user = $this->staff();
        $folder = $this->folderFor($user);

        $request = $this->create($user, ['folder' => $folder->uuid]);

        $this->assertStringContainsString('/r/', $request['link']);
        $this->assertSame('Intake', $request['destination']['name']);
        $this->assertArrayNotHasKey('token', $request);
        $this->assertTrue($request['open']);
    }

    public function test_a_visitor_can_upload_and_the_file_lands_in_the_chosen_folder(): void
    {
        $user = $this->staff();
        $folder = $this->folderFor($user);
        $this->create($user, ['folder' => $folder->uuid]);

        $token = FileRequest::firstOrFail()->token;

        $this->upload($token, UploadedFile::fake()->create('passport.pdf', 12, 'application/pdf'), ['name' => 'Jane Doe'])->assertCreated();

        $file = FileItem::firstOrFail();
        $this->assertSame($folder->id, $file->folder_id);
        // Nobody is signed in, so the requester owns what arrives — otherwise
        // the file would be invisible to every access rule in the library.
        $this->assertSame($user->id, $file->owner_id);

        $fileRequest = FileRequest::firstOrFail();
        $this->assertSame(1, $fileRequest->upload_count);
        $this->assertSame('Jane Doe', $fileRequest->uploads()->firstOrFail()->uploader_name);
    }

    /** With no folder chosen, uploads land in the requester's File Box. */
    public function test_a_request_without_a_folder_collects_into_the_file_box(): void
    {
        $user = $this->staff();
        $this->create($user);

        $token = FileRequest::firstOrFail()->token;

        $this->upload($token, UploadedFile::fake()->create('notes.pdf', 4, 'application/pdf'))->assertCreated();

        $file = FileItem::firstOrFail();
        $this->assertNull($file->folder_id);
        $this->assertSame($user->id, $file->owner_id);
    }

    public function test_a_disallowed_file_type_is_refused(): void
    {
        $user = $this->staff();
        $this->create($user, ['allowedExtensions' => ['documents']]);

        $token = FileRequest::firstOrFail()->token;

        $this->upload($token, UploadedFile::fake()->image('selfie.png'))->assertStatus(422);

        $this->assertSame(0, FileItem::count());
    }

    /**
     * "Any file type" is the requester's list, not the safety check — an
     * executable is still refused.
     */
    public function test_an_executable_is_refused_even_when_all_types_are_allowed(): void
    {
        $user = $this->staff();
        $this->create($user);

        $token = FileRequest::firstOrFail()->token;

        $this->upload($token, UploadedFile::fake()->createWithContent('invoice.php', '<?php echo 1;'))->assertStatus(422);

        $this->assertSame(0, FileItem::count());
    }

    public function test_an_oversize_file_is_refused(): void
    {
        $user = $this->staff();
        // 10 KB ceiling; the upload below is 40 KB.
        $this->create($user, ['maxBytes' => 10 * 1024]);

        $token = FileRequest::firstOrFail()->token;

        $this->upload($token, UploadedFile::fake()->create('big.pdf', 40, 'application/pdf'))->assertStatus(422);

        $this->assertSame(0, FileItem::count());
    }

    public function test_the_link_stops_accepting_once_the_file_limit_is_reached(): void
    {
        $user = $this->staff();
        $this->create($user, ['allowMultiple' => false]);

        $token = FileRequest::firstOrFail()->token;

        $this->upload($token, UploadedFile::fake()->create('one.pdf', 4, 'application/pdf'))->assertCreated();

        $this->upload($token, UploadedFile::fake()->create('two.pdf', 4, 'application/pdf'))->assertStatus(422);

        $this->assertSame(1, FileItem::count());
    }

    public function test_an_expired_link_is_closed_to_both_the_page_and_the_upload(): void
    {
        $user = $this->staff();
        $this->create($user);

        $fileRequest = FileRequest::firstOrFail();
        $fileRequest->forceFill(['expires_at' => now()->subDay()])->save();

        $this->get('/r/'.$fileRequest->token)->assertStatus(410);
        $this->upload($fileRequest->token, UploadedFile::fake()->create('late.pdf', 4, 'application/pdf'))->assertStatus(410);

        $this->assertSame(0, FileItem::count());
    }

    public function test_a_revoked_link_is_closed(): void
    {
        $user = $this->staff();
        $request = $this->create($user);

        $this->actingAs($user)->deleteJson('/portal/files/requests/'.$request['id'])->assertOk();

        $token = FileRequest::firstOrFail()->token;
        $this->get('/r/'.$token)->assertStatus(410);
        $this->upload($token, UploadedFile::fake()->create('late.pdf', 4, 'application/pdf'))->assertStatus(410);
    }

    public function test_a_password_protected_link_asks_before_it_accepts_anything(): void
    {
        $user = $this->staff();
        $this->create($user, ['password' => 'open-sesame']);

        $token = FileRequest::firstOrFail()->token;

        // The page asks rather than showing the drop zone…
        $this->get('/r/'.$token)->assertOk()->assertSee('Password required');

        // …and the upload endpoint refuses until the session is unlocked, so a
        // form posted straight past the page gets nowhere.
        $this->upload($token, UploadedFile::fake()->create('doc.pdf', 4, 'application/pdf'))->assertStatus(403);

        $this->post('/r/'.$token.'/unlock', ['password' => 'wrong'])->assertStatus(422);
        $this->post('/r/'.$token.'/unlock', ['password' => 'open-sesame'])->assertRedirect('/r/'.$token);

        $this->upload($token, UploadedFile::fake()->create('doc.pdf', 4, 'application/pdf'))->assertCreated();
    }

    /** A folder the requester cannot write to is not a destination they can pick. */
    public function test_a_request_cannot_point_at_a_folder_the_creator_cannot_upload_to(): void
    {
        $owner = $this->staff();
        $folder = $this->folderFor($owner, 'Private');

        $outsider = $this->staff(['account_type' => 'Client']);

        $this->actingAs($outsider)->postJson('/portal/files/requests', [
            'title' => 'Send me things',
            'folder' => $folder->uuid,
        ])->assertStatus(403);

        $this->assertSame(0, FileRequest::count());
    }

    public function test_only_the_creator_or_an_administrator_can_manage_a_request(): void
    {
        $user = $this->staff();
        $request = $this->create($user);

        $other = $this->staff();
        $this->actingAs($other)->getJson('/portal/files/requests/'.$request['id'])->assertStatus(403);
        $this->actingAs($other)->deleteJson('/portal/files/requests/'.$request['id'])->assertStatus(403);

        $admin = $this->staff(['account_type' => 'Administrator']);
        $this->actingAs($admin)->getJson('/portal/files/requests/'.$request['id'])->assertOk();
    }

    /** Clearing the password is an empty string; omitting the key changes nothing. */
    public function test_updating_can_clear_a_password_and_close_the_request(): void
    {
        $user = $this->staff();
        $request = $this->create($user, ['password' => 'first-pass']);

        $this->actingAs($user)
            ->patchJson('/portal/files/requests/'.$request['id'], ['title' => 'Renamed'])
            ->assertOk()
            ->assertJsonPath('request.hasPassword', true)
            ->assertJsonPath('request.title', 'Renamed');

        $this->actingAs($user)
            ->patchJson('/portal/files/requests/'.$request['id'], ['password' => ''])
            ->assertOk()
            ->assertJsonPath('request.hasPassword', false);

        $this->actingAs($user)
            ->patchJson('/portal/files/requests/'.$request['id'], ['closed' => true])
            ->assertOk()
            ->assertJsonPath('request.open', false);

        $this->get('/r/'.FileRequest::firstOrFail()->token)->assertStatus(410);
    }

    /**
     * The invitation goes out inline, not on the queue.
     *
     * A queued request email is indistinguishable from no request email at all
     * when nothing is draining the queue, and this is the one message the whole
     * feature depends on arriving.
     */
    public function test_the_request_can_be_emailed_from_the_dialog(): void
    {
        $user = $this->staff(['name' => 'Rae Okoro']);
        $request = $this->create($user, [
            'recipientEmail' => 'jane@example.com',
            'recipientName' => 'Jane Doe',
            'expiresAt' => now()->addWeek()->toDateString(),
            'allowedExtensions' => ['documents'],
            'send' => true,
        ]);

        $this->assertTrue($request['open']);

        Mail::assertSent(Postcard::class, function (Postcard $mail) {
            return $mail->hasTo('jane@example.com')
                && str_contains($mail->subjectLine, 'Rae Okoro')
                // The rules the recipient needs before they start scanning.
                && collect($mail->payload['details'] ?? [])->contains(fn ($row) => $row[0] === 'Accepted')
                && str_contains($mail->payload['button']['url'] ?? '', '/r/');
        });
    }

    /** Sending later, from the created-link panel, reaches the same place. */
    public function test_a_link_created_without_a_recipient_can_be_sent_afterwards(): void
    {
        $user = $this->staff();
        $request = $this->create($user);

        Mail::assertNothingSent();

        $this->actingAs($user)
            ->postJson('/portal/files/requests/'.$request['id'].'/send', ['email' => 'later@example.com'])
            ->assertOk()
            ->assertJsonPath('emailed', true);

        Mail::assertSent(Postcard::class, fn (Postcard $mail) => $mail->hasTo('later@example.com'));
        $this->assertSame('later@example.com', FileRequest::firstOrFail()->recipient_email);
    }

    /** A closed request is not something to keep inviting people into. */
    public function test_a_closed_request_cannot_be_sent(): void
    {
        $user = $this->staff();
        $request = $this->create($user);

        $this->actingAs($user)
            ->patchJson('/portal/files/requests/'.$request['id'], ['closed' => true])
            ->assertOk();

        $this->actingAs($user)
            ->postJson('/portal/files/requests/'.$request['id'].'/send', ['email' => 'jane@example.com'])
            ->assertStatus(422);

        Mail::assertNothingSent();
    }

    /** The upload page shows the destination folder's contents to nobody. */
    public function test_the_upload_page_leaks_nothing_about_the_destination(): void
    {
        $user = $this->staff();
        $folder = $this->folderFor($user, 'Intake');

        FileItem::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'folder_id' => $folder->id,
            'name' => 'existing-secret.pdf',
            'extension' => 'pdf',
            'size' => 10,
            'disk' => 'local',
            'storage_path' => 'vault/x.pdf',
            'owner_id' => $user->id,
            'uploaded_by' => $user->id,
        ]);

        $this->create($user, ['folder' => $folder->uuid]);

        $this->get('/r/'.FileRequest::firstOrFail()->token)
            ->assertOk()
            ->assertDontSee('existing-secret.pdf');
    }

    private function rrmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $path = $dir.'/'.$entry;
            is_dir($path) ? $this->rrmdir($path) : @unlink($path);
        }
        @rmdir($dir);
    }
}
