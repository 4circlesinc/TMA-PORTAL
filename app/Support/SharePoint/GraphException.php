<?php

namespace App\Support\SharePoint;

class GraphException extends \RuntimeException
{
    public function __construct(string $message, public readonly int $status = 0)
    {
        parent::__construct($message);
    }
}
