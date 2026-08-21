<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

abstract class TestCase extends BaseTestCase
{
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
}
