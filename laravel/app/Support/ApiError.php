<?php

namespace App\Support;

use RuntimeException;

/** An error the API reports as {error: {code, message, details}}. */
class ApiError extends RuntimeException
{
    public function __construct(public int $status, string $message, public string $errorCode = 'ERROR', public mixed $details = null)
    {
        parent::__construct($message);
    }

    public static function badRequest(string $m, mixed $details = null): self
    {
        return new self(400, $m, 'BAD_REQUEST', $details);
    }

    public static function notFound(string $m = 'Not found'): self
    {
        return new self(404, $m, 'NOT_FOUND');
    }

    public static function forbidden(string $m = 'You do not have permission to do this'): self
    {
        return new self(403, $m, 'FORBIDDEN');
    }

    public static function conflict(string $m, string $code = 'CONFLICT', mixed $details = null): self
    {
        return new self(409, $m, $code, $details);
    }

    public static function unauthenticated(): self
    {
        return new self(401, 'Please sign in', 'UNAUTHENTICATED');
    }
}
