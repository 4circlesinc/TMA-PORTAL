<?php

namespace App\Http\Controllers\Bespoke;

use App\Http\Controllers\Controller;
use App\Support\Activity\ActivityLogger;
use App\Support\Bespoke\Actions\SendMessage;
use App\Support\Bespoke\Attachments;
use App\Support\Bespoke\Bespoke;
use App\Support\Bespoke\Completions;
use App\Support\Bespoke\Confidential;
use App\Support\Bespoke\Conversations;
use App\Support\Bespoke\Knowledge;
use App\Support\Bespoke\Page;
use App\Support\Bespoke\Prompt;
use App\Support\Bespoke\Suggestions;
use App\Support\Bespoke\Toolbox;
use App\Support\Bespoke\Transcription;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

/**
 * In-portal assistant. FEATURE_BESPOKE is the gate: 404 when off, including
 * for administrators. The browser never supplies the account type.
 */
class BespokeController extends Controller
{
    public function suggestions(Request $request): JsonResponse
    {
        Bespoke::abortUnlessEnabled();

        $user = $request->user();
        $identity = Bespoke::identity($user);
        $page = Page::fromClient([
            'path' => $request->query('path', '/'),
            'view' => $request->query('view', ''),
            'title' => $request->query('title', ''),
        ]);
        $configured = Bespoke::configured();

        return response()->json([
            'enabled' => true,
            'configured' => $configured,
            'cipEnabled' => $identity['cipEnabled'],
            'subtitle' => Suggestions::subtitle($page),
            'pageTitle' => $page['title'],
            'chips' => Suggestions::for($user, $identity, $page, $configured),
            'faq' => Knowledge::clientFaqPayload($user, $identity),
            'allowedPaths' => Knowledge::allowedPaths($user, $identity),
        ]);
    }

    public function chat(Request $request): JsonResponse
    {
        Bespoke::abortUnlessEnabled();

        $validated = $request->validate([
            'messages' => ['required', 'array', 'min:1', 'max:20'],
            'messages.*.role' => ['required', 'in:user,assistant'],
            'messages.*.content' => ['required', 'string', 'max:4000'],
            'clientContext' => ['sometimes', 'array'],
            'clientContext.path' => ['sometimes', 'nullable', 'string', 'max:180'],
            'clientContext.view' => ['sometimes', 'nullable', 'string', 'max:40'],
            'clientContext.title' => ['sometimes', 'nullable', 'string', 'max:80'],
            'clientContext.fieldHints' => ['sometimes', 'array', 'max:40'],
            'clientContext.fieldHints.*.label' => ['required_with:clientContext.fieldHints', 'string', 'max:80'],
            'clientContext.fieldHints.*.empty' => ['sometimes', 'boolean'],
            'conversationId' => ['sometimes', 'nullable', 'uuid'],
            'attachments' => ['sometimes', 'array', 'max:'.Attachments::MAX_PER_MESSAGE],
            'attachments.*' => ['uuid'],
        ]);

        $user = $request->user();
        $identity = Bespoke::identity($user);
        $clientContext = is_array($validated['clientContext'] ?? null) ? $validated['clientContext'] : [];
        $page = Page::fromClient($clientContext);
        $fieldHints = Page::fieldHints($clientContext);
        $conversation = Conversations::resolveForChat(
            $user,
            isset($validated['conversationId']) ? (string) $validated['conversationId'] : null,
        );
        $conversationId = $conversation->uuid;
        $configured = Bespoke::configured();

        $messages = [];
        foreach ($validated['messages'] as $row) {
            $messages[] = [
                'role' => $row['role'],
                'content' => $row['content'],
            ];
        }

        $lastUser = '';
        for ($i = count($messages) - 1; $i >= 0; $i--) {
            if ($messages[$i]['role'] === 'user') {
                $lastUser = $messages[$i]['content'];
                break;
            }
        }

        $attached = Attachments::claim($conversation, $user, $validated['attachments'] ?? []);

        $local = Knowledge::match($user, $identity, $page, $lastUser, $fieldHints);
        $source = 'local';
        $reply = is_array($local) ? (string) $local['answer'] : null;
        $toolbox = new Toolbox($user, $identity, $page, $conversation);

        // How the portal is built, secured, hosted, or paid for is not the
        // model's to discuss; the question never reaches it.
        $confidential = Confidential::asks($lastUser);
        if ($confidential) {
            $reply = Confidential::REFUSAL;
        }

        if ($configured && ! $confidential) {
            $history = array_slice($messages, -12);
            // What was just dropped in rides with the question itself; older
            // files stay reachable through read_attachment.
            if ($attached->isNotEmpty() && $history !== []) {
                $lastIndex = count($history) - 1;
                if ($history[$lastIndex]['role'] === 'user') {
                    $history[$lastIndex]['content'] .= "\n\n".Attachments::contextFor($attached);
                }
            }
            $model = Completions::run(
                Prompt::system($user, $identity, $page, $fieldHints, $toolbox->attachmentFacts()),
                $history,
                $toolbox,
            );
            if (is_string($model) && $model !== '') {
                $reply = $toolbox->adoptLeakedChoices($model);
                $source = 'model';
                if (Confidential::leaks($reply)) {
                    $reply = Confidential::REFUSAL;
                    $source = 'local';
                }
            }
        }

        if ($reply === null || $reply === '') {
            $reply = $configured
                ? 'I could not reach the language model. Try a suggestion, or ask an administrator.'
                : 'Bespoke AI isn’t configured for live answers. I can still help with navigation and the user guide. Try a suggestion, or ask an administrator.';
            $source = 'local';
        }

        $allowed = Knowledge::allowedPaths($user, $identity);
        $reply = Knowledge::sanitizeAnswer($reply, $allowed);

        $turn = Conversations::appendTurn($conversation, $lastUser, $reply);
        if ($turn && $attached->isNotEmpty()) {
            Attachments::attachTo($turn, $attached);
        }
        $conversation->refresh();

        ActivityLogger::log([
            'type' => 'bespoke.asked',
            'description' => 'Asked Bespoke AI on '.$page['path'],
            'actor' => $user,
            'metadata' => [
                'path' => $page['path'],
                'kind' => $page['kind'],
                'conversation' => $conversationId,
                'configured' => $configured,
                'source' => $source,
                'tools' => $toolbox->used(),
                'confidential' => $confidential,
            ],
        ]);

        return response()->json([
            'reply' => $reply,
            'configured' => $configured,
            'source' => $source,
            'conversationId' => $conversationId,
            'title' => $conversation->title,
            'actions' => $toolbox->actions(),
            'choices' => $toolbox->choices(),
        ]);
    }

    /** One file for this chat, staged until the message that carries it is sent. */
    public function uploadAttachment(Request $request): JsonResponse
    {
        Bespoke::abortUnlessEnabled();

        $validated = $request->validate([
            'file' => ['required', 'file', 'max:'.(Attachments::MAX_BYTES / 1024)],
            'conversationId' => ['required', 'uuid'],
            'text' => ['sometimes', 'nullable', 'string', 'max:'.Attachments::MAX_TEXT_CHARS],
            'pages' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:5000'],
            'kind' => ['sometimes', 'in:upload,derived'],
        ]);

        $user = $request->user();
        $conversation = Conversations::resolveForChat($user, (string) $validated['conversationId']);

        $attachment = Attachments::stage($validated['file'], $conversation, $user, [
            'text' => $validated['text'] ?? null,
            'pages' => $validated['pages'] ?? null,
            'kind' => $validated['kind'] ?? Attachments::KIND_UPLOAD,
        ]);

        // Something the portal made (a 2×2 photo) is not waiting for a
        // message: it hangs off the latest turn, so it is kept and shows
        // when the thread is reopened.
        if ($attachment->kind === Attachments::KIND_DERIVED) {
            $latest = $conversation->messages()->latest('id')->first();
            if ($latest) {
                Attachments::attachTo($latest, collect([$attachment]));
                $attachment->refresh();
            }
        }

        return response()->json(['attachment' => Attachments::payload($attachment)], 201);
    }

    /**
     * Speech to text for the live voice, for browsers whose own recognition
     * has no service behind it (the desktop shell, Brave). The clip goes to
     * the same provider as the chat and is not kept.
     */
    public function transcribe(Request $request): JsonResponse
    {
        Bespoke::abortUnlessEnabled();

        $validator = Validator::make($request->all(), [
            'audio' => ['required', 'file', 'max:'.(Transcription::MAX_BYTES / 1024)],
            'language' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Za-z]{2}$/'],
        ]);
        if ($validator->fails()) {
            // A validation failure is never logged by itself, and a clip the
            // server would not take looks, from the stage, like a clip it
            // could not understand. Say which, with what arrived.
            $audio = $request->file('audio');
            Log::warning('Bespoke AI transcription rejected', [
                'errors' => $validator->errors()->all(),
                'hasAudio' => $request->hasFile('audio'),
                'bytes' => $audio instanceof UploadedFile ? $audio->getSize() : null,
                'mime' => $audio instanceof UploadedFile ? $audio->getClientMimeType() : null,
                'uploadError' => $audio instanceof UploadedFile ? $audio->getError() : null,
                'language' => $request->input('language'),
                'contentLength' => $request->header('Content-Length'),
            ]);
            throw new ValidationException($validator);
        }
        $validated = $validator->validated();

        if (! Bespoke::configured()) {
            return response()->json(['message' => 'Voice isn’t available here.'], 503);
        }

        $started = microtime(true);
        $text = Transcription::transcribe($validated['audio'], $validated['language'] ?? null);
        if ($text === null) {
            return response()->json(['message' => 'The clip could not be transcribed.'], 502);
        }
        Log::info('Bespoke AI transcription', [
            'bytes' => $validated['audio']->getSize(),
            'ms' => (int) round((microtime(true) - $started) * 1000),
            'chars' => strlen($text),
        ]);

        return response()->json(['text' => $text]);
    }

    /** The bytes, to the reader who uploaded them and nobody else. */
    public function showAttachment(Request $request, string $uuid): SymfonyResponse
    {
        Bespoke::abortUnlessEnabled();

        $attachment = Attachments::findOwnedOrFail($request->user(), $uuid);

        return Attachments::stream($attachment, download: $request->boolean('download'));
    }

    /**
     * The reader's own click on Send. The draft came from a tool, but reach
     * is checked again here; the model's word is never what sends.
     */
    public function sendMessage(Request $request): JsonResponse
    {
        Bespoke::abortUnlessEnabled();

        $validated = $request->validate([
            'userId' => ['required', 'integer'],
            'body' => ['required', 'string', 'max:4000'],
            'conversationId' => ['sometimes', 'nullable', 'uuid'],
        ]);

        $user = $request->user();
        $sent = SendMessage::run($user, (int) $validated['userId'], $validated['body']);

        $conversationId = isset($validated['conversationId']) ? (string) $validated['conversationId'] : null;
        $note = 'Sent to '.$sent['recipient']['name'].'. [Open Messages]('.$sent['url'].')';
        if ($conversationId !== null) {
            $thread = Conversations::findOwned($user, $conversationId);
            if ($thread) {
                Conversations::appendNote($thread, $note);
            }
        }

        ActivityLogger::log([
            'type' => 'bespoke.sent_message',
            'description' => 'Sent a Bespoke AI draft to '.$sent['recipient']['name'],
            'actor' => $user,
            'metadata' => [
                'recipient' => $sent['recipient']['userId'],
                'conversation' => $conversationId,
                'thread' => $sent['conversationUuid'],
            ],
        ]);

        return response()->json([
            'ok' => true,
            'recipient' => $sent['recipient'],
            'url' => $sent['url'],
            'note' => $note,
        ]);
    }

    public function conversations(Request $request): JsonResponse
    {
        Bespoke::abortUnlessEnabled();

        $items = Conversations::listFor($request->user())
            ->map(fn ($conversation) => Conversations::listPayload($conversation))
            ->values()
            ->all();

        return response()->json(['conversations' => $items]);
    }

    public function showConversation(Request $request, string $uuid): JsonResponse
    {
        Bespoke::abortUnlessEnabled();

        $conversation = Conversations::findOwnedOrFail($request->user(), $uuid);

        return response()->json([
            'conversation' => Conversations::detailPayload($conversation),
        ]);
    }

    public function updateConversation(Request $request, string $uuid): JsonResponse
    {
        Bespoke::abortUnlessEnabled();

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:80'],
        ]);

        $conversation = Conversations::rename(
            Conversations::findOwnedOrFail($request->user(), $uuid),
            $validated['title'],
        );

        return response()->json([
            'conversation' => Conversations::listPayload($conversation->load('latestMessage')),
        ]);
    }

    public function destroyConversation(Request $request, string $uuid): JsonResponse
    {
        Bespoke::abortUnlessEnabled();

        Conversations::findOwnedOrFail($request->user(), $uuid)->delete();

        return response()->json(['ok' => true]);
    }
}
