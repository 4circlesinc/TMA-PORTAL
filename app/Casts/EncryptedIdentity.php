<?php

namespace App\Casts;

use App\Support\Security\IdentityFields;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Encrypts passport numbers and dates of birth, and keeps a HMAC lookup
 * sibling column so duplicate checks still work without SQL-on-ciphertext.
 *
 * @implements CastsAttributes<mixed, mixed>
 */
class EncryptedIdentity implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): mixed
    {
        $open = IdentityFields::open(is_string($value) ? $value : null);

        if ($open === null) {
            return null;
        }

        if ($key === 'date_of_birth') {
            return Carbon::parse($open)->startOfDay();
        }

        return $open;
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): array
    {
        $plain = $this->plain($key, $value);
        $lookupKey = $key.'_lookup';

        return [
            $key => IdentityFields::seal($plain),
            $lookupKey => IdentityFields::lookup($plain),
        ];
    }

    private function plain(string $key, mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if ($value instanceof \DateTimeInterface) {
            return Carbon::parse($value)->toDateString();
        }

        $string = is_string($value) || is_numeric($value) ? trim((string) $value) : null;
        if ($string === null || $string === '') {
            return null;
        }

        if ($key === 'date_of_birth') {
            return Carbon::parse($string)->toDateString();
        }

        return $string;
    }
}
