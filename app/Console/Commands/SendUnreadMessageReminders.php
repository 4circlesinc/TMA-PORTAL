<?php

namespace App\Console\Commands;

use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Support\Mail\Postcards;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Escalating email nudges for unread portal messages: ~1h, ~20h and a final
 * ~24h. One tier per unread streak — the participant's reminder_tier records
 * the highest already sent, and reading the conversation resets it.
 *
 * Scheduled every fifteen minutes (routes/console.php). Needs a queue worker +
 * the scheduler running to actually deliver.
 */
class SendUnreadMessageReminders extends Command
{
    protected $signature = 'messaging:send-unread-reminders';

    protected $description = 'Email escalating reminders for unread portal messages (1h/20h/24h).';

    /** Hours-old of the newest unread message that qualifies for each tier. */
    private const TIERS = [3 => 24, 2 => 20, 1 => 1];

    public function handle(): int
    {
        $sent = 0;

        ConversationParticipant::query()
            ->whereNull('left_at')
            ->whereNull('archived_at')
            ->where(fn ($q) => $q->whereNull('muted_until')->orWhere('muted_until', '<', now()))
            ->with('user')
            ->chunkById(200, function ($participants) use (&$sent) {
                foreach ($participants as $participant) {
                    $sent += $this->process($participant) ? 1 : 0;
                }
            });

        $this->info("Sent {$sent} reminder(s).");

        return self::SUCCESS;
    }

    private function process(ConversationParticipant $participant): bool
    {
        // The newest real (non-system) message from someone else that this
        // participant still hasn't read.
        $message = Message::query()
            ->where('conversation_id', $participant->conversation_id)
            ->where('id', '>', $participant->last_read_message_id ?? 0)
            ->where('id', '>', $participant->cleared_before_message_id ?? 0)
            ->where('type', '!=', Message::TYPE_SYSTEM)
            ->where(fn ($q) => $q->whereNull('user_id')->orWhere('user_id', '!=', $participant->user_id))
            ->latest('id')
            ->first();

        // Nothing unread: clear any streak so the next one starts fresh.
        if (! $message) {
            if ($participant->reminder_tier) {
                $participant->forceFill(['reminder_tier' => 0])->save();
            }

            return false;
        }

        $tier = $this->tierFor($message->created_at->diffInHours(now()));
        if ($tier === 0 || $tier <= $participant->reminder_tier) {
            return false;
        }

        $user = $participant->user;
        if (! $user || ! $user->email) {
            return false;
        }

        Mail::to($user->email)->queue(Postcards::messageReminder(
            $tier,
            $message->sender?->name ?? 'A colleague',
            $this->preview($message),
            url('/social/messages'),
        ));

        $participant->forceFill(['reminder_tier' => $tier])->save();

        return true;
    }

    private function tierFor(int $ageHours): int
    {
        foreach (self::TIERS as $tier => $minHours) {
            if ($ageHours >= $minHours) {
                return $tier;
            }
        }

        return 0;
    }

    private function preview(Message $message): ?string
    {
        return match ($message->type) {
            Message::TYPE_TEXT => Str::limit(trim((string) $message->body), 140) ?: null,
            Message::TYPE_VOICE => 'Sent you a voice note.',
            Message::TYPE_ATTACHMENT => 'Sent you an attachment.',
            default => null,
        };
    }
}
