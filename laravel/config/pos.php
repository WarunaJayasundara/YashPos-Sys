<?php

// YASH POS settings (read through config() so `php artisan config:cache` keeps working).
return [
    'cookie_secure' => env('COOKIE_SECURE', '0') === '1',
    'trust_proxy' => env('TRUST_PROXY', '0') === '1',
    'session_ttl_hours' => (int) env('SESSION_TTL_HOURS', 12),
    'login_rate_limit' => (int) env('LOGIN_RATE_LIMIT', 10),
    'tz_offset_minutes' => (int) env('TZ_OFFSET_MINUTES', 330),
    'seed_admin_password' => env('SEED_ADMIN_PASSWORD', ''),
    'seed_demo' => env('SEED_DEMO', '0') === '1',
    'install_key' => env('INSTALL_KEY', ''),
];
