<?php

namespace App\Support;

use Illuminate\Support\Facades\Validator;

/** Validation that fails with {error: {code: VALIDATION, details: {formErrors, fieldErrors}}}, the shape the app reads. */
class V
{
    public static function check(array $data, array $rules, array $messages = []): array
    {
        $v = Validator::make($data, $rules, $messages);
        if ($v->fails()) {
            $fields = [];
            foreach ($v->errors()->messages() as $key => $msgs) {
                $top = explode('.', $key)[0];
                $fields[$top] = array_merge($fields[$top] ?? [], $msgs);
            }
            throw new ApiError(422, 'Validation failed', 'VALIDATION', ['formErrors' => [], 'fieldErrors' => $fields]);
        }

        return $v->validated();
    }

    /** A positive integer id from the URL; anything else (abc, 1.5, 0) is not found. */
    public static function id(mixed $raw): int
    {
        if (! is_string($raw) && ! is_int($raw) || ! preg_match('/^[1-9]\d{0,9}$/', (string) $raw)) {
            throw ApiError::notFound();
        }

        return (int) $raw;
    }

    public const MONEY = ['numeric', 'min:0', 'max:100000000'];

    public const APPROVAL = ['approval' => ['sometimes', 'nullable', 'array'], 'approval.username' => ['required_with:approval', 'string'], 'approval.password' => ['required_with:approval', 'string']];

    /** Trims strings in the given keys, turning '' into null when $emptyNull. */
    public static function trim(array $data, array $keys, bool $emptyNull = false): array
    {
        foreach ($keys as $k) {
            if (array_key_exists($k, $data) && is_string($data[$k])) {
                $data[$k] = trim($data[$k]);
                if ($emptyNull && $data[$k] === '') {
                    $data[$k] = null;
                }
            }
        }

        return $data;
    }
}
