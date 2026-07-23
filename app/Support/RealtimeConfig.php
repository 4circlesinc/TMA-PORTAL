<?php

namespace App\Support;

/**
 * The public Reverb connection details the browser needs to open a websocket.
 * Only the public app key is exposed; the secret never leaves the server, and
 * subscribing to a private channel still passes /broadcasting/auth as the
 * session user. Mirrors MessagingController's bootstrap so every surface that
 * wants live updates (messaging, notifications) shares one connection.
 *
 * @return array{enabled:bool, key?:string, host?:string, port?:int, scheme?:string}
 */
final class RealtimeConfig
{
    public static function client(): array
    {
        if (config('broadcasting.default') !== 'reverb') {
            return ['enabled' => false];
        }

        $options = config('broadcasting.connections.reverb.options', []);

        return [
            'enabled' => true,
            'key' => config('broadcasting.connections.reverb.key'),
            'host' => $options['host'] ?? config('reverb.servers.reverb.hostname', 'localhost'),
            'port' => (int) ($options['port'] ?? 8080),
            'scheme' => $options['scheme'] ?? 'http',
        ];
    }
}
