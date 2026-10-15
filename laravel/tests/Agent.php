<?php

namespace Tests;

use Illuminate\Testing\TestResponse;

/** A signed-in (or anonymous) browser: sends the session cookie and, unless told otherwise, the CSRF header. */
class Agent
{
    public function __construct(private TestCase $t, private ?string $session = null) {}

    private function cookies(): array
    {
        return $this->session ? ['yash_sid' => $this->session] : [];
    }

    public function get(string $uri, array $query = []): TestResponse
    {
        return $this->t->call('GET', $uri, $query, $this->cookies(), [], ['HTTP_ACCEPT' => 'application/json']);
    }

    public function send(string $method, string $uri, mixed $body = [], bool $csrf = true): TestResponse
    {
        $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'] + ($csrf ? ['HTTP_X_REQUESTED_WITH' => 'yash-pos'] : []);

        return $this->t->call($method, $uri, [], $this->cookies(), [], $server, json_encode($body));
    }

    public function post(string $uri, mixed $body = [], bool $csrf = true): TestResponse
    {
        return $this->send('POST', $uri, $body, $csrf);
    }

    public function put(string $uri, mixed $body = []): TestResponse
    {
        return $this->send('PUT', $uri, $body);
    }

    public function patch(string $uri, mixed $body = []): TestResponse
    {
        return $this->send('PATCH', $uri, $body);
    }
}
