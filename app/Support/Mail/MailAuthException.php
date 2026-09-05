<?php

namespace App\Support\Mail;

use Illuminate\Contracts\Debug\ShouldntReport;
use RuntimeException;

/**
 * The mailbox needs the user to reconnect, a revoked grant, a changed
 * password, or scopes that were never granted. Distinct from a transient
 * failure because retrying it is pointless; the UI prompts a reconnect.
 *
 * Not reported: it is an expected state the UI branches on (409 +
 * reconnect), and the site search asks the mailbox on every pause in
 * typing, for every account — with or without a mailbox connected.
 */
class MailAuthException extends RuntimeException implements ShouldntReport {}
