<?php

namespace App\Support\Signatures;

use RuntimeException;

/**
 * The signed document couldn't be produced.
 *
 * Recoverable by design: the signatures themselves live in the database, so a
 * failure here loses the rendered PDF, never the fact that someone signed.
 */
class StampingException extends RuntimeException {}
