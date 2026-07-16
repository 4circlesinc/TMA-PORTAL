<?php

namespace App\Support\Signatures;

use RuntimeException;

/** A request that isn't fit to send. The message is shown to the sender. */
class SendValidationException extends RuntimeException {}
