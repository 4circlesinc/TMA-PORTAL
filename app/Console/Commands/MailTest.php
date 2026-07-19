<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Mail;

/**
 * Send a plain test message through the configured mailer to prove credentials
 * and transport work. Sends synchronously - the real portal mailables are all
 * ShouldQueue, which swallows transport errors into failed_jobs, so a queued
 * send is useless for diagnosing "why is nothing arriving".
 */
class MailTest extends Command
{
    protected $signature = 'mail:test {to : Address to send the test message to}
                            {--mailer= : Override the configured mailer (smtp, resend, log)}';

    protected $description = 'Send a test email through the configured mailer';

    public function handle(): int
    {
        $to = $this->argument('to');
        $mailer = $this->option('mailer') ?: config('mail.default');

        $this->line('');
        $this->line('  mailer  '.$mailer);

        if ($mailer === 'smtp') {
            $this->line('  host    '.config('mail.mailers.smtp.host').':'.config('mail.mailers.smtp.port'));
            $this->line('  user    '.(config('mail.mailers.smtp.username') ?: '<empty>'));
        }

        $this->line('  from    '.config('mail.from.address'));
        $this->line('  to      '.$to);
        $this->line('');

        try {
            Mail::mailer($mailer)->raw(
                "Test message from ".config('app.name')." at ".now()->toDateTimeString().".\n\n"
                ."If you are reading this, the {$mailer} transport is working.",
                fn ($message) => $message->to($to)->subject('['.config('app.name').'] Mail test')
            );
        } catch (\Throwable $e) {
            $this->error('Send failed: '.$e->getMessage());

            return self::FAILURE;
        }

        $this->info($mailer === 'log'
            ? 'Written to storage/logs/laravel.log (log driver sends nothing).'
            : 'Accepted by the transport. Check the inbox, and the spam folder.');

        return self::SUCCESS;
    }
}
