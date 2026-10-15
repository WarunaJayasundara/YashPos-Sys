<?php

// Recreates the empty test database before the suite (credentials from .env, name from phpunit.xml).
require __DIR__.'/../vendor/autoload.php';

Dotenv\Dotenv::createImmutable(dirname(__DIR__))->safeLoad();
$name = getenv('DB_DATABASE') ?: ($_ENV['DB_DATABASE'] ?? '');
if (! preg_match('/test/i', $name)) {
    throw new RuntimeException('Refusing to reset a database whose name does not contain "test"');
}
$pdo = new PDO(sprintf('mysql:host=%s;port=%s', $_ENV['DB_HOST'] ?? '127.0.0.1', $_ENV['DB_PORT'] ?? '3306'), $_ENV['DB_USERNAME'] ?? 'root', $_ENV['DB_PASSWORD'] ?? '');
$pdo->exec("DROP DATABASE IF EXISTS `$name`");
$pdo->exec("CREATE DATABASE `$name` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
