<?php

namespace App\Support\Files;

use RuntimeException;

/**
 * Thrown when an upload is rejected for a specific, explainable reason
 * (too large, unsafe type, spoofed content). Controllers translate it into a
 * 422 with the exact message — never a generic "Something went wrong".
 */
class FileValidationException extends RuntimeException
{
}
