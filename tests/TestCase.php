<?php

namespace Tests;

use App\Models\User;
use App\Support\Files\FileAccess;
use App\Support\Realtime\Live;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Http\UploadedFile;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        /*
         * Start with an empty realtime buffer.
         *
         * Live collects signals in a static and sends them on terminate, which
         * a test kernel never reaches. Without this, whatever the last test
         * queued is still pending when the next one starts watching, so a
         * signal assertion passes alone and fails in a full run depending on
         * what ran before it.
         */
        Live::discard();

        /*
         * FileAccess memos roles by user id and file id. RefreshDatabase
         * reuses those ids, so a grant from the previous test becomes a
         * wrong answer about a different person 2. A real request starts
         * with an empty cache; PHPUnit does not.
         */
        FileAccess::forgetFolders();
        \App\Support\Cip\Requirements::flush();
        \App\Support\Cip\Review::flushTally();
        \App\Support\Cip\Package::forget();
    }

    /**
     * The body of a file response, however it happens to be sent.
     *
     * Vault picks its delivery per storage: bytes on a local disk go out as a
     * BinaryFileResponse (which answers Range, so a video seeks and pdf.js can
     * ask for one page), bytes in object storage as a stream. Both are the
     * same file to the reader, and a test that wants to know what was served
     * should not have to know which.
     */
    protected function fileBody(TestResponse $response): string
    {
        $base = $response->baseResponse;

        if ($base instanceof BinaryFileResponse) {
            return (string) file_get_contents($base->getFile()->getPathname());
        }

        if ($base instanceof StreamedResponse) {
            return $response->streamedContent();
        }

        return $response->getContent();
    }

    /** A minimal PDF for CIP decision-letter uploads in feature tests. */
    protected function cipDecisionLetterPdf(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('decision-letter.pdf', '%PDF-1.4 decision');
    }

    /**
     * POST a CIP decision (multipart). Omits `decisionLetter` from `$data` to
     * exercise validation; pass `decisionLetter => null` to skip the default PDF.
     *
     * @param  array<string, mixed>  $data
     */
    protected function postCipDecision(User $user, string $applicationUuid, array $data = []): TestResponse
    {
        $letter = array_key_exists('decisionLetter', $data)
            ? $data['decisionLetter']
            : $this->cipDecisionLetterPdf();

        unset($data['decisionLetter']);

        if ($letter !== null) {
            $data['decisionLetter'] = $letter;
        }

        return $this->actingAs($user)->post(
            '/portal/cip/applications/'.$applicationUuid.'/decision',
            $data,
            ['Accept' => 'application/json', 'X-Requested-With' => 'XMLHttpRequest'],
        );
    }
}
