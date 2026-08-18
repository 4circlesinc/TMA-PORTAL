<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDecisionTemplate;
use App\Models\User;

/**
 * §23 — Granted and Denied letters, one pair per investment type.
 *
 * The filing subject is still {@see Notices::line}. This is the body the
 * administrator keeps: title and letter, with {{placeholders}} filled from
 * the application at send time. Missing rows fall back to the shipped
 * defaults rather than sending a blank letter.
 */
class Letters
{
    /**
     * Tokens an administrator may put in a letter.
     *
     * @return list<array{token:string, meaning:string}>
     */
    public static function placeholders(): array
    {
        return [
            ['token' => 'number', 'meaning' => 'Application number (CIP number once it has one)'],
            ['token' => 'applicant', 'meaning' => 'Main applicant’s name'],
            ['token' => 'provider', 'meaning' => 'Service provider'],
            ['token' => 'familySize', 'meaning' => 'Family size as F4'],
            ['token' => 'investmentType', 'meaning' => 'Investment type, including the Other wording'],
            ['token' => 'decisionDate', 'meaning' => 'Decision date'],
            ['token' => 'recipient', 'meaning' => 'Name of the person this copy is addressed to'],
        ];
    }

    /**
     * The ten shipped letters. firstOrCreate uses these; restore writes them
     * back. An administrator's rewording is never overwritten by a re-seed.
     *
     * @return array<string, array<string, array{title:string, body:string}>>
     */
    public static function defaults(): array
    {
        $letters = [];

        foreach (InvestmentType::ALL as $type => $label) {
            $letters[$type] = [
                Status::GRANTED => [
                    'title' => '{{number}} was granted',
                    'body' => 'The Unit has granted {{applicant}}’s application under the '.$label.' route.',
                ],
                Status::DENIED => [
                    'title' => '{{number}} was denied',
                    'body' => 'The Unit has denied {{applicant}}’s application under the '.$label.' route.',
                ],
            ];
        }

        return $letters;
    }

    /** Make sure all ten rows exist. Safe to call on every admin listing. */
    public static function ensure(): void
    {
        foreach (self::defaults() as $type => $outcomes) {
            foreach ($outcomes as $decision => $copy) {
                CipDecisionTemplate::query()->firstOrCreate(
                    [
                        'investment_type' => $type,
                        'decision' => $decision,
                    ],
                    [
                        'title' => $copy['title'],
                        'body' => $copy['body'],
                    ],
                );
            }
        }
    }

    public static function restore(CipDecisionTemplate $template, ?User $actor = null): CipDecisionTemplate
    {
        $copy = self::defaults()[$template->investment_type][$template->decision]
            ?? ['title' => $template->title, 'body' => $template->body];

        $template->forceFill([
            'title' => $copy['title'],
            'body' => $copy['body'],
            'updated_by' => $actor?->id,
        ])->save();

        return $template->refresh();
    }

    /**
     * The letter this application should send for this outcome.
     *
     * An unknown or empty investment type uses Other — that is the catch-all
     * the form already has, and a file with no type still has to produce a
     * letter the day it is decided.
     */
    public static function for(CipApplication $application, string $decision): CipDecisionTemplate
    {
        $type = InvestmentType::isValid($application->investment_type)
            ? $application->investment_type
            : InvestmentType::OTHER;

        $copy = self::defaults()[$type][$decision]
            ?? self::defaults()[InvestmentType::OTHER][$decision];

        return CipDecisionTemplate::query()->firstOrCreate(
            [
                'investment_type' => $type,
                'decision' => $decision,
            ],
            [
                'title' => $copy['title'],
                'body' => $copy['body'],
            ],
        );
    }

    /**
     * Title, lead and optional extra paragraphs, placeholders filled.
     *
     * @return array{title:string, lead:string, bodyHtml:?string}
     */
    public static function copy(CipApplication $application, string $decision, ?string $recipientName = null): array
    {
        $template = self::for($application, $decision);
        $vars = self::vars($application, $recipientName);
        $title = self::fill($template->title, $vars);
        $paragraphs = preg_split("/\n\s*\n/", trim(self::fill($template->body, $vars))) ?: [];
        $paragraphs = array_values(array_filter(array_map('trim', $paragraphs), fn (string $p) => $p !== ''));

        $lead = $paragraphs[0] ?? '';
        $rest = array_slice($paragraphs, 1);

        return [
            'title' => $title,
            'lead' => $lead,
            'bodyHtml' => $rest === []
                ? null
                : collect($rest)->map(fn (string $p) => '<p>'.nl2br(e($p), false).'</p>')->implode(''),
        ];
    }

    public static function fill(string $text, array $vars): string
    {
        return (string) preg_replace_callback(
            '/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/',
            function (array $match) use ($vars) {
                $key = $match[1];

                if (array_key_exists($key, $vars)) {
                    return (string) $vars[$key];
                }

                $camel = lcfirst(str_replace(' ', '', ucwords(str_replace('_', ' ', $key))));

                return array_key_exists($camel, $vars) ? (string) $vars[$camel] : $match[0];
            },
            $text,
        );
    }

    public static function isCustomized(CipDecisionTemplate $template): bool
    {
        $copy = self::defaults()[$template->investment_type][$template->decision] ?? null;

        if ($copy === null) {
            return true;
        }

        return $template->title !== $copy['title'] || $template->body !== $copy['body'];
    }

    /**
     * @return array<string, string>
     */
    public static function vars(CipApplication $application, ?string $recipientName = null): array
    {
        $facts = Contacts::facts($application);

        return [
            'number' => $facts['number'],
            'applicant' => $facts['applicant'],
            'provider' => $facts['provider'],
            'familySize' => 'F'.$facts['familySize'],
            'investmentType' => InvestmentType::display(
                $application->investment_type,
                $application->investment_type_other,
            ),
            'decisionDate' => $application->decided_at?->format('d.m.Y')
                ?? $application->decided_at?->toDateString()
                ?? '',
            'recipient' => (string) ($recipientName ?? ''),
        ];
    }
}
