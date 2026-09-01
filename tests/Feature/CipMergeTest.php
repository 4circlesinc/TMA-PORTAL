<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Tree;
use App\Support\Files\Vault;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use ZipArchive;

/**
 * Mail merge: a Word template with {{shortcodes}} filled from one
 * application. Graph is not configured under test, so the filed result is
 * the merged .docx — the same bytes the PDF would be rendered from.
 */
class CipMergeTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::create(['name' => 'Ada Admin', 'email' => 'ada@example.com', 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
        ])->save();

        return $user;
    }

    private function application(User $staff): CipApplication
    {
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $staff);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        return $application->refresh();
    }

    /** A real (minimal) .docx whose body splits a token across two runs. */
    private function template(User $owner): FileItem
    {
        $tmp = tempnam(sys_get_temp_dir(), 'tpl');
        $zip = new ZipArchive;
        $zip->open($tmp, ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml',
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            .'<Default Extension="xml" ContentType="application/xml"/>'
            .'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
        $zip->addFromString('_rels/.rels',
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
        $zip->addFromString('word/document.xml',
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            .'<w:p><w:r><w:t>Re {{number}} for {{applicant}} via {{prov</w:t></w:r><w:r><w:t>ider}}</w:t></w:r></w:p>'
            .'</w:body></w:document>');
        $zip->close();

        $stored = Vault::store($tmp, 'docx');
        @unlink($tmp);

        return FileItem::create([
            'uuid' => $stored['uuid'],
            'name' => 'Engagement letter.docx',
            'extension' => 'docx',
            'mime_type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'size' => $stored['size'],
            'disk' => $stored['disk'],
            'storage_path' => $stored['path'],
            'checksum' => $stored['checksum'],
            'owner_id' => $owner->id,
            'uploaded_by' => $owner->id,
        ]);
    }

    public function test_the_template_list_offers_word_documents(): void
    {
        $admin = $this->admin();
        $this->template($admin);

        $this->actingAs($admin)->getJson('/portal/cip/merge-templates')
            ->assertOk()
            ->assertJsonPath('templates.0.name', 'Engagement letter.docx')
            ->assertJsonStructure(['placeholders']);
    }

    public function test_generating_files_a_merged_document_with_the_application(): void
    {
        $admin = $this->admin();
        $application = $this->application($admin);
        $template = $this->template($admin);

        $body = $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/generate-document', [
                'file' => $template->uuid,
            ])
            ->assertOk()
            ->json();

        $this->assertFalse($body['converted'], 'no Graph under test, the merged .docx is filed');
        $this->assertSame('Chen Wei – Engagement letter.docx', $body['file']['name']);

        // Filed in the Additional Documents drawer.
        $file = FileItem::where('uuid', $body['file']['id'])->firstOrFail();
        $drawer = Tree::additionalFolder($application->fresh());
        $this->assertNotNull($drawer);
        $this->assertSame($drawer->id, $file->folder_id);

        // And genuinely merged: the split {{provider}} came out as Galaxy.
        $local = Vault::localCopy($file);
        $zip = new ZipArchive;
        $zip->open($local);
        $document = (string) $zip->getFromName('word/document.xml');
        $zip->close();

        $this->assertStringContainsString('Chen Wei', $document);
        $this->assertStringContainsString('Galaxy', $document);
        $this->assertStringContainsString($application->displayNumber(), $document);
        $this->assertStringNotContainsString('{{', $document);
    }

    public function test_the_provider_side_cannot_generate(): void
    {
        $admin = $this->admin();
        $application = $this->application($admin);
        $template = $this->template($admin);

        $outsider = User::create(['name' => 'Gil Contact', 'email' => 'gil@example.com', 'password' => bcrypt('password12345')]);
        $outsider->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => 'Client',
        ])->save();

        $this->actingAs($outsider)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/generate-document', [
                'file' => $template->uuid,
            ])
            ->assertNotFound();
    }
}
