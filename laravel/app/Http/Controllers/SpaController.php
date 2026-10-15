<?php

namespace App\Http\Controllers;

/** Serves the built React app (public/index.html) for every non-API page, so links like /pos work. */
class SpaController
{
    public function __invoke()
    {
        $index = public_path('index.html');
        if (! is_file($index)) {
            return response('The app is not built yet. Run: npm run build:laravel', 503);
        }

        return response(file_get_contents($index), 200, ['Content-Type' => 'text/html; charset=utf-8', 'Cache-Control' => 'no-cache']);
    }
}
