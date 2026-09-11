<?php

namespace App\Support\Bespoke;

use App\Models\BespokeAttachment;
use App\Models\BespokeConversation;
use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\User;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * What the model may do on this reader's behalf, and nothing else.
 *
 * Every tool runs under the reader's own identity with the portal's own
 * access rules — a client asking for "all applications" gets the same rows
 * the CIP list would show them. Tools never send anything: a draft becomes
 * an *action* the browser renders with Send / Cancel, and the reader's own
 * click is what sends it, through an endpoint that checks reach again.
 */
final class Toolbox
{
    /** @var list<array<string, mixed>> */
    private array $actions = [];

    /** @var list<string> */
    private array $choices = [];

    /** @var list<string> */
    private array $used = [];

    /**
     * @param  array<string, mixed>  $identity
     * @param  array{path: string, view: string, title: string, kind: string}  $page
     */
    /** @var Collection<int, BespokeAttachment>|null */
    private ?Collection $attachments = null;

    public function __construct(
        private readonly User $user,
        private readonly array $identity,
        private readonly array $page,
        private readonly ?BespokeConversation $conversation = null,
    ) {}

    /** @return Collection<int, BespokeAttachment> */
    private function attachments(): Collection
    {
        if ($this->attachments === null) {
            $this->attachments = $this->conversation
                ? Attachments::forConversation($this->conversation, $this->user)
                : collect();
        }

        return $this->attachments;
    }

    /**
     * Prompt lines about the files in this chat, so the model knows what it
     * may read or resize without guessing at ids.
     *
     * @return list<string>
     */
    public function attachmentFacts(): array
    {
        $files = $this->attachments();
        if ($files->isEmpty()) {
            return ['Files: none attached in this chat. The reader can attach up to five (PDF, image, text) with the paperclip.'];
        }
        $lines = ['Files in this chat (id — name — what it is):'];
        foreach ($files as $a) {
            $lines[] = '- '.$a->uuid.' — '.$a->name.' — '.Attachments::describe($a).($a->hasText() ? ', text available via read_attachment' : '');
        }
        $lines[] = 'read_attachment returns a file\'s text in slices. resize_photo makes a 2×2 inch passport photo (600×600 or larger, square) from an image or the first page of a PDF; the result appears under your answer with Download. You cannot see image contents; never describe a photo.';

        return $lines;
    }

    /** @return list<array<string, mixed>> */
    public function actions(): array
    {
        return $this->actions;
    }

    /** @return list<string> */
    public function choices(): array
    {
        return $this->choices;
    }

    /** @return list<string> */
    public function used(): array
    {
        return array_values(array_unique($this->used));
    }

    /**
     * Some models write a tool call as text instead of calling it. A blob
     * such as `[Offer choices]{"options": [...]}` in the answer becomes the
     * real thing here, and the blob leaves the text.
     */
    public function adoptLeakedChoices(string $reply): string
    {
        $pattern = '/\s*(?:\[[^\]\n]{0,40}\]\s*)?\{\s*"options"\s*:\s*\[(.*?)\]\s*\}/s';
        if (preg_match($pattern, $reply, $m) !== 1) {
            return $reply;
        }
        $decoded = json_decode('['.$m[1].']', true);
        if (is_array($decoded) && $this->choices === []) {
            $this->offerChoices(['options' => $decoded]);
        }

        return trim((string) preg_replace($pattern, '', $reply, 1));
    }

    public function cipAvailable(): bool
    {
        return $this->identity['cipEnabled']
            && ($this->identity['cipReach'] || Bespoke::can($this->user, 'clients.view'));
    }

    public function mailAvailable(): bool
    {
        return Bespoke::can($this->user, 'mail.use');
    }

    /**
     * OpenAI-style tool definitions, only the ones this reader may use.
     *
     * @return list<array<string, mixed>>
     */
    public function definitions(): array
    {
        $tools = [
            self::define('lookup_people',
                'Find colleagues this reader may contact: by name, by role such as "administrator", or by what they look after such as "IT" or "web". Returns name, account type, job title, and userId. Call before naming anyone or drafting a message to them.',
                ['query' => ['type' => 'string', 'description' => 'Name, role word, or topic. Empty lists administrators.']],
                []),
            self::define('lookup_guide',
                'Search the portal user guide for how a screen or feature works. Use when unsure. Returns matching guide sections.',
                ['query' => ['type' => 'string']],
                ['query']),
            self::define('propose_message',
                'Draft a portal message to one person by userId. The portal shows the draft with Send and Cancel and asks the reader to confirm; nothing is sent by this call. Plain text, no markdown.',
                [
                    'userId' => ['type' => 'integer', 'description' => 'From lookup_people.'],
                    'body' => ['type' => 'string', 'description' => 'The message text, written as the reader, first person.'],
                ],
                ['userId', 'body']),
            self::define('offer_choices',
                'Show two to four short reply buttons under your answer, for a question the reader must decide: which colleague, which file, yes or no.',
                [
                    'options' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'Two to four labels, each under 40 characters.'],
                ],
                ['options']),
        ];

        if ($this->cipAvailable()) {
            $tools[] = self::define('list_applications',
                'List CIP applications this reader can open. scope "recent" = latest files, "mine" = files this reader started. Optional status label or search text (number or applicant name).',
                [
                    'scope' => ['type' => 'string', 'enum' => ['recent', 'mine']],
                    'status' => ['type' => 'string', 'description' => 'A status label such as "New Applications" or "Draft".'],
                    'q' => ['type' => 'string', 'description' => 'Application number or applicant name.'],
                    'limit' => ['type' => 'integer', 'description' => '1 to 10.'],
                ],
                []);
            $tools[] = self::define('get_application',
                'One CIP application by its number (for example GAL26-00012 or a CIP number), with status, meaning, people, dates, and the link to open it.',
                ['number' => ['type' => 'string']],
                ['number']);
        }

        if ($this->attachments()->isNotEmpty()) {
            $tools[] = self::define('read_attachment',
                'Read the text of a file attached to this chat, in slices of up to 6000 characters. Use offset to continue.',
                [
                    'attachmentId' => ['type' => 'string', 'description' => 'The file id from the prompt.'],
                    'offset' => ['type' => 'integer', 'description' => 'Character offset to start from. Default 0.'],
                ],
                ['attachmentId']);
            $tools[] = self::define('resize_photo',
                'Make a 2×2 inch passport photo from an attached image, or from page 1 of an attached PDF. The portal does the cropping and shows the result with Download; this call only asks for it.',
                ['attachmentId' => ['type' => 'string']],
                ['attachmentId']);
        }

        if ($this->mailAvailable()) {
            $tools[] = self::define('propose_email',
                'Draft an email the reader will send from the Email page. The portal opens the draft there; nothing is sent by this call. Body is plain text; paragraphs separated by blank lines.',
                [
                    'to' => ['type' => 'string', 'description' => 'Recipient addresses, comma-separated.'],
                    'cc' => ['type' => 'string'],
                    'subject' => ['type' => 'string'],
                    'body' => ['type' => 'string'],
                ],
                ['to', 'subject', 'body']);
        }

        return $tools;
    }

    /**
     * Run one tool. Unknown names and refused requests return an error the
     * model can read; nothing throws.
     *
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function call(string $name, array $args): array
    {
        $this->used[] = $name;

        return match ($name) {
            'lookup_people' => $this->lookupPeople($args),
            'lookup_guide' => $this->lookupGuide($args),
            'propose_message' => $this->proposeMessage($args),
            'propose_email' => $this->proposeEmail($args),
            'offer_choices' => $this->offerChoices($args),
            'list_applications' => $this->listApplications($args),
            'get_application' => $this->getApplication($args),
            'read_attachment' => $this->readAttachment($args),
            'resize_photo' => $this->resizePhoto($args),
            default => ['error' => 'Unknown tool.'],
        };
    }

    // ------------------------------------------------------------ people

    /** @param  array<string, mixed>  $args */
    private function lookupPeople(array $args): array
    {
        $query = trim((string) ($args['query'] ?? ''));
        $people = People::search($this->user, $query === '' ? 'administrator' : $query);

        if ($people === []) {
            return [
                'people' => [],
                'note' => $this->identity['isStaff']
                    ? 'No approved account matches.'
                    : 'Nobody matching is on this reader\'s team. Clients can message the staff assigned to them and the administrators.',
            ];
        }

        return ['people' => $people];
    }

    /** @param  array<string, mixed>  $args */
    private function lookupGuide(array $args): array
    {
        $query = trim((string) ($args['query'] ?? ''));
        $sections = Guide::search($this->user, $this->identity, $query);
        $faqs = [];
        foreach (Knowledge::visibleFaqs($this->user, $this->identity) as $faq) {
            if (Knowledge::scoreFor($query, $faq) >= 4) {
                $faqs[] = ['q' => $faq['q'], 'answer' => $faq['answer']];
            }
            if (count($faqs) >= 2) {
                break;
            }
        }

        if ($sections === [] && $faqs === []) {
            return ['sections' => [], 'note' => 'Nothing in the guide matches. Say so rather than guessing, and offer support@tmantoinelaw.com.'];
        }

        return ['sections' => $sections, 'faq' => $faqs];
    }

    /** @param  array<string, mixed>  $args */
    private function proposeMessage(array $args): array
    {
        $userId = (int) ($args['userId'] ?? 0);
        $body = trim((string) ($args['body'] ?? ''));
        if ($body === '') {
            return ['error' => 'The message body is empty.'];
        }
        $recipient = People::reachableById($this->user, $userId);
        if ($recipient === null) {
            return ['error' => 'That person is not someone this reader can message. Use lookup_people and pick from its results.'];
        }

        $row = People::row($recipient);
        $this->actions[] = [
            'type' => 'message',
            'to' => ['userId' => $row['userId'], 'name' => $row['name'], 'jobTitle' => $row['jobTitle'], 'accountType' => $row['accountType']],
            'body' => Str::limit($body, 4000, ''),
        ];

        return [
            'ok' => true,
            'recipient' => $row,
            'note' => 'The draft is now on screen with Send and Cancel; the reader confirms before anything goes. Tell them Send is below. Do not say it was sent.',
        ];
    }

    /** @param  array<string, mixed>  $args */
    private function proposeEmail(array $args): array
    {
        if (! $this->mailAvailable()) {
            return ['error' => 'Email is not available for this account type. Offer Messages instead.'];
        }

        $to = self::addresses($args['to'] ?? '');
        $cc = self::addresses($args['cc'] ?? '');
        $subject = trim((string) ($args['subject'] ?? ''));
        $body = trim((string) ($args['body'] ?? ''));
        if ($to === []) {
            return ['error' => 'No valid recipient address. Ask the reader for the address, or look the person up.'];
        }
        if ($body === '') {
            return ['error' => 'The email body is empty.'];
        }

        $this->actions[] = [
            'type' => 'email',
            'to' => $to,
            'cc' => $cc,
            'subject' => Str::limit($subject, 200, ''),
            'body' => Str::limit($body, 8000, ''),
        ];

        return [
            'ok' => true,
            'note' => 'The draft is on screen with Open in Email. The reader sends it from the Email page. Do not say it was sent.',
        ];
    }

    /** @param  array<string, mixed>  $args */
    private function offerChoices(array $args): array
    {
        $options = $args['options'] ?? [];
        if (! is_array($options)) {
            return ['error' => 'options must be a list of strings.'];
        }
        $clean = [];
        foreach ($options as $option) {
            $label = trim(preg_replace('/\s+/u', ' ', (string) $option) ?? '');
            if ($label === '' || in_array($label, $clean, true)) {
                continue;
            }
            $clean[] = Str::limit($label, 40, '');
            if (count($clean) === 4) {
                break;
            }
        }
        if (count($clean) < 2) {
            return ['error' => 'Give at least two options.'];
        }
        $this->choices = $clean;

        return ['ok' => true, 'options' => $clean];
    }

    // ------------------------------------------------------- attachments

    private function attachment(string $id): ?BespokeAttachment
    {
        return $this->attachments()->first(fn (BespokeAttachment $a) => $a->uuid === $id);
    }

    /** @param  array<string, mixed>  $args */
    private function readAttachment(array $args): array
    {
        $a = $this->attachment(trim((string) ($args['attachmentId'] ?? '')));
        if ($a === null) {
            return ['error' => 'No such file in this chat. Use an id from the prompt.'];
        }
        if (! $a->hasText()) {
            return [
                'name' => $a->name,
                'text' => '',
                'note' => $a->isImage()
                    ? 'This is an image; there is no text to read and you cannot see it.'
                    : 'No text layer in this file (a scanned PDF, perhaps). Say so rather than guessing.',
            ];
        }
        $text = (string) $a->text;
        $length = mb_strlen($text);
        $offset = max(0, min($length, (int) ($args['offset'] ?? 0)));
        $slice = mb_substr($text, $offset, 6000);
        $next = $offset + mb_strlen($slice);

        return [
            'name' => $a->name,
            'offset' => $offset,
            'length' => $length,
            'text' => $slice,
            'nextOffset' => $next < $length ? $next : null,
        ];
    }

    /** @param  array<string, mixed>  $args */
    private function resizePhoto(array $args): array
    {
        $a = $this->attachment(trim((string) ($args['attachmentId'] ?? '')));
        if ($a === null) {
            return ['error' => 'No such file in this chat. Use an id from the prompt.'];
        }
        if (! $a->isImage() && ! $a->isPdf()) {
            return ['error' => 'Only an image or a PDF can become a 2×2 photo.'];
        }
        if ($a->isImage() && $a->width && $a->height && min($a->width, $a->height) < 600) {
            return ['error' => 'That image is only '.$a->width.'×'.$a->height.'. A 2×2 photo needs at least 600 pixels on the short side; ask for a larger original.'];
        }

        $this->actions[] = [
            'type' => 'photo2x2',
            'attachment' => Attachments::payload($a),
        ];

        return [
            'ok' => true,
            'note' => 'The portal is making the 2×2 photo now; it appears under your answer with Download. Tell the reader that. It is 600×600 or larger, square, and trimmed of white margins.',
        ];
    }

    // ------------------------------------------------------ applications

    /** @param  array<string, mixed>  $args */
    private function listApplications(array $args): array
    {
        if (! $this->cipAvailable()) {
            return ['error' => 'CIP Applications are not available for this account type.'];
        }

        $scope = (string) ($args['scope'] ?? 'recent');
        $limit = max(1, min(10, (int) ($args['limit'] ?? 6)));
        $status = self::statusFromLabel((string) ($args['status'] ?? ''));
        $q = mb_strtolower(trim((string) ($args['q'] ?? '')));

        $query = ApplicationScope::query($this->user)
            ->with(['people', 'client', 'provider', 'assignedOfficer']);
        if ($scope === 'mine') {
            $query->where('cip_applications.created_by', $this->user->id);
        }
        if ($status !== null) {
            $query->where('cip_applications.status', $status);
        }
        if ($q !== '') {
            $needle = '%'.$q.'%';
            $query->where(function ($w) use ($needle) {
                $w->whereRaw('lower(coalesce(cip_applications.internal_number, \'\')) like ?', [$needle])
                    ->orWhereRaw('lower(coalesce(cip_applications.cip_number, \'\')) like ?', [$needle])
                    ->orWhereHas('people', function ($p) use ($needle) {
                        $p->whereRaw('lower(coalesce(first_name, \'\') || \' \' || coalesce(last_name, \'\')) like ?', [$needle]);
                    })
                    ->orWhereHas('client', fn ($c) => $c->whereRaw('lower(coalesce(name, \'\')) like ?', [$needle]));
            });
        }

        $total = (clone $query)->count();
        $rows = $query->orderByDesc('cip_applications.id')->limit($limit)->get();

        return [
            'scope' => $scope,
            'total' => $total,
            'applications' => $rows->map(fn (CipApplication $a) => $this->applicationRow($a))->values()->all(),
            'note' => $total === 0
                ? ($scope === 'mine' ? 'This reader has not started any application that is still theirs to open.' : 'No applications match for this reader.')
                : 'Open the list: /citizenship-applications. Each row carries its own link.',
        ];
    }

    /** @param  array<string, mixed>  $args */
    private function getApplication(array $args): array
    {
        if (! $this->cipAvailable()) {
            return ['error' => 'CIP Applications are not available for this account type.'];
        }

        $number = mb_strtolower(trim((string) ($args['number'] ?? '')));
        if ($number === '') {
            return ['error' => 'Give the application number.'];
        }

        $application = ApplicationScope::query($this->user)
            ->with(['people', 'client', 'provider', 'assignedOfficer'])
            ->where(function ($w) use ($number) {
                $w->whereRaw('lower(coalesce(cip_applications.internal_number, \'\')) = ?', [$number])
                    ->orWhereRaw('lower(coalesce(cip_applications.cip_number, \'\')) = ?', [$number]);
            })
            ->first();

        if ($application === null) {
            return ['error' => 'No application with that number is open to this reader. Do not guess about it.'];
        }

        $row = $this->applicationRow($application);
        $row['people'] = $application->people->map(fn (CipPerson $p) => [
            'name' => trim(($p->first_name ?? '').' '.($p->last_name ?? '')),
            'role' => $p->role,
        ])->values()->all();
        $row['decidedAt'] = $application->decided_at?->toDateString();
        $row['decision'] = $application->decision;
        $row['updatedAt'] = $application->updated_at?->toDateString();
        $row['statusMeaning'] = Knowledge::statuses()[$row['status']] ?? null;

        return ['application' => $row];
    }

    /** @return array<string, mixed> */
    private function applicationRow(CipApplication $a): array
    {
        $main = $a->people->first(fn (CipPerson $p) => $p->role === CipPerson::ROLE_MAIN_APPLICANT) ?? $a->people->first();
        $applicant = $main
            ? trim(($main->first_name ?? '').' '.($main->last_name ?? ''))
            : (string) ($a->client?->name ?? '');
        $clientUid = $a->client?->uid;
        $phase = $a->phase ?? Phase::PRE_APPROVAL;

        $row = [
            'number' => $a->displayNumber(),
            'applicant' => $applicant !== '' ? $applicant : null,
            'status' => Status::label($a->status),
            'phase' => Phase::label($phase),
            'provider' => $a->provider?->name,
            'family' => 'F'.max(1, $a->familySize()),
            'createdAt' => $a->created_at?->toDateString(),
            'submittedAt' => $a->submitted_at?->toDateString(),
            'link' => $clientUid ? '/citizenship-applications/'.$clientUid : '/citizenship-applications',
            'startedByMe' => (int) $a->created_by === (int) $this->user->id,
        ];
        if ($this->identity['isStaff']) {
            $row['officer'] = $a->assignedOfficer?->name;
        }

        return $row;
    }

    // ----------------------------------------------------------- helpers

    private static function statusFromLabel(string $label): ?string
    {
        $label = mb_strtolower(trim($label));
        if ($label === '') {
            return null;
        }
        foreach (Status::ALL as $status) {
            if ($label === mb_strtolower($status) || $label === mb_strtolower(Status::label($status))) {
                return $status;
            }
        }

        return null;
    }

    /** @return list<string> */
    private static function addresses(mixed $raw): array
    {
        $parts = is_array($raw) ? $raw : (preg_split('/[;,]+/', (string) $raw) ?: []);
        $out = [];
        foreach ($parts as $part) {
            $part = trim((string) $part);
            if (preg_match('/<([^>]+)>/', $part, $m) === 1) {
                $part = trim($m[1]);
            }
            if ($part !== '' && filter_var($part, FILTER_VALIDATE_EMAIL) && ! in_array($part, $out, true)) {
                $out[] = $part;
            }
            if (count($out) === 10) {
                break;
            }
        }

        return $out;
    }

    /**
     * @param  array<string, array<string, mixed>>  $properties
     * @param  list<string>  $required
     * @return array<string, mixed>
     */
    private static function define(string $name, string $description, array $properties, array $required): array
    {
        return [
            'type' => 'function',
            'function' => [
                'name' => $name,
                'description' => $description,
                'parameters' => [
                    'type' => 'object',
                    'properties' => $properties === [] ? new \stdClass : $properties,
                    'required' => $required,
                ],
            ],
        ];
    }
}
