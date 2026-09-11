<?php

namespace App\Http\Controllers\Bespoke;

use App\Http\Controllers\Controller;
use App\Support\Activity\ActivityLogger;
use App\Support\Bespoke\Bespoke;
use App\Support\Bespoke\Completions;
use App\Support\Bespoke\Conversations;
use App\Support\Bespoke\Knowledge;
use App\Support\Bespoke\Page;
use App\Support\Bespoke\Prompt;
use App\Support\Bespoke\Suggestions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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

        $local = Knowledge::match($user, $identity, $page, $lastUser, $fieldHints);
        $source = 'local';
        $reply = is_array($local) ? (string) $local['answer'] : null;

        if ($configured) {
            $history = array_slice($messages, -12);
            $model = Completions::complete(
                Prompt::system($user, $identity, $page, $fieldHints),
                $history,
            );
            if (is_string($model) && $model !== '') {
                $reply = $model;
                $source = 'model';
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

        Conversations::appendTurn($conversation, $lastUser, $reply);
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
            ],
        ]);

        return response()->json([
            'reply' => $reply,
            'configured' => $configured,
            'source' => $source,
            'conversationId' => $conversationId,
            'title' => $conversation->title,
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
