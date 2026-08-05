<?php

namespace App\Support\Smartsheet;

use RuntimeException;

class SmartsheetException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status = 0,
    ) {
        parent::__construct($message);
    }
}
