<?php

namespace App\Support\Documents;

use App\Models\SharePointConnection;
use App\Support\SharePoint\Drive;
use App\Support\SharePoint\GraphClient;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use ZipArchive;

/**
 * Mail merge for Word documents: {{shortcodes}} typed into a .docx are
 * replaced with real values, and the result can come back as a PDF.
 *
 * The template is a Word file, never a PDF, on purpose. A PDF is positioned
 * glyph runs in subsetted fonts — replacing text inside one reliably is not a
 * thing; every mail-merge system on earth merges the source document instead.
 * A .docx is a zip of XML, so the merge is honest string work, with one
 * Word-specific wrinkle handled below: Word freely splits a typed
 * "{{provider}}" across several runs (spell-check, formatting history), so
 * the token has to be stitched back together before it can be seen.
 *
 * The PDF comes from Microsoft Graph, which renders Word documents with
 * Word's own fidelity — the merged file is parked in a connected SharePoint
 * library for the seconds the conversion takes, then deleted. When Graph is
 * not configured the caller receives null and can fall back to filing the
 * merged .docx itself.
 */
class DocxMerge
{
    /** The document parts that can carry visible text. */
    private const PARTS = '~^word/(document\.xml|header\d*\.xml|footer\d*\.xml|footnotes\.xml|endnotes\.xml)$~';

    /**
     * Fill every {{token}} in the document with its value.
     *
     * @param  array<string, string>  $vars
     */
    public static function merge(string $docxPath, array $vars): string
    {
        $working = tempnam(sys_get_temp_dir(), 'merge');
        copy($docxPath, $working);

        $zip = new ZipArchive;
        if ($zip->open($working) !== true) {
            @unlink($working);
            throw new \InvalidArgumentException('That file is not a Word document.');
        }

        try {
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $name = (string) $zip->getNameIndex($i);

                if (! preg_match(self::PARTS, $name)) {
                    continue;
                }

                $xml = (string) $zip->getFromIndex($i);
                $filled = self::fillXml($xml, $vars);

                if ($filled !== $xml) {
                    $zip->addFromString($name, $filled);
                }
            }
        } finally {
            $zip->close();
        }

        $bytes = (string) file_get_contents($working);
        @unlink($working);

        return $bytes;
    }

    /**
     * One XML part: stitch split tokens back together, then substitute.
     *
     * @param  array<string, string>  $vars
     */
    public static function fillXml(string $xml, array $vars): string
    {
        $xml = self::stitchSplitTokens($xml);

        return (string) preg_replace_callback(
            '/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/',
            function (array $match) use ($vars) {
                $key = $match[1];

                if (! array_key_exists($key, $vars)) {
                    // An unknown code stays visible rather than vanishing —
                    // a typo the reader can see beats a silent blank.
                    return $match[0];
                }

                return htmlspecialchars((string) $vars[$key], ENT_XML1 | ENT_QUOTES, 'UTF-8');
            },
            $xml,
        );
    }

    /**
     * Word splits typed text into runs wherever it likes, so "{{provider}}"
     * often lives in the XML as {{prov</w:t></w:r><w:r><w:t>ider}}. Find
     * brace pairs whose interior is only token characters and markup, and
     * collapse the markup out of them — the surviving text keeps the
     * formatting of the run the opening brace sat in.
     */
    private static function stitchSplitTokens(string $xml): string
    {
        return (string) preg_replace_callback(
            '/\{(?:<[^>]*>)*\{(?:[a-zA-Z0-9_\s]|<[^>]*>)*?\}(?:<[^>]*>)*\}/s',
            function (array $match) {
                $plain = strip_tags($match[0]);

                return preg_match('/^\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\}$/', $plain)
                    ? $plain
                    : $match[0];
            },
            $xml,
        );
    }

    /**
     * Word-fidelity PDF via Microsoft Graph, or null when Graph (or a
     * connected library to borrow) is not available.
     *
     * The merged document visits the connected library's root for the seconds
     * the conversion takes. The synchroniser may glimpse it in a delta window;
     * the next delta confirms the deletion and it settles itself.
     */
    public static function toPdf(string $docxBytes): ?string
    {
        if (! GraphClient::isConfigured()) {
            return null;
        }

        $connection = SharePointConnection::query()
            ->where('sync_enabled', true)
            ->where('drive_kind', 'documentLibrary')
            ->whereNotNull('root_item_id')
            ->first();

        if (! $connection) {
            return null;
        }

        $tmp = tempnam(sys_get_temp_dir(), 'docx');
        file_put_contents($tmp, $docxBytes);

        $itemId = null;

        try {
            $item = Drive::upload(
                $connection->drive_id,
                $connection->root_item_id,
                'portal-merge-'.Str::random(12).'.docx',
                $tmp,
            );
            $itemId = $item['id'] ?? null;

            if (! $itemId) {
                return null;
            }

            $token = GraphClient::token();
            $response = Http::withToken((string) $token)
                ->connectTimeout(15)
                ->timeout(120)
                ->get(
                    "https://graph.microsoft.com/v1.0/drives/{$connection->drive_id}/items/{$itemId}/content",
                    ['format' => 'pdf'],
                );

            if (! $response->successful() || $response->body() === '') {
                return null;
            }

            return $response->body();
        } catch (\Throwable $e) {
            report($e);

            return null;
        } finally {
            @unlink($tmp);

            if ($itemId) {
                try {
                    GraphClient::request('DELETE', "/drives/{$connection->drive_id}/items/{$itemId}");
                } catch (\Throwable) {
                    // A leftover temp file in the library is untidy, not fatal.
                }
            }
        }
    }
}
