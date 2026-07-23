<?php

namespace App\Support\Calendar;

/**
 * A whole-file ICS problem — unreadable, empty, or too large. A *single* bad
 * event is not this: those are collected as skipped entries so the rest of the
 * file still imports.
 */
class IcsException extends \RuntimeException {}
