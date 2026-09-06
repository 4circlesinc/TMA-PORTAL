<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Avatar Disk
    |--------------------------------------------------------------------------
    |
    | Disk used for user-uploaded profile photos. Local disks are ephemeral on
    | Laravel Cloud (wiped on deploy, not shared across instances), so set
    | AVATAR_DISK=s3 in production to persist uploads in a bucket.
    |
    */

    'avatar_disk' => env('AVATAR_DISK', 'public'),

    // Disk that stores file-manager (vault) bytes. 'local' for dev; 's3' (R2)
    // in production so uploads persist across deploys. Chunk assembly and
    // thumbnail caches always use local scratch regardless of this.
    'files_disk' => env('FILES_DISK', 'local'),

    /*
     * Whether a preview may be answered with a short-lived signed link
     * straight to the object store instead of streaming through PHP.
     *
     * On by default, and it is most of why a photo opens at once: the bytes go
     * Cloudflare→reader rather than Cloudflare→us→reader. Only element `src`
     * loads (image/video/audio) take it — see Vault::mayRedirect. Set
     * FILES_SIGNED_URLS=false to put everything back through the proxy.
     */
    'files_signed_urls' => (bool) env('FILES_SIGNED_URLS', true),

    /*
     * Envelope-encrypt vault bytes and call recordings with a firm-held key
     * (derived from APP_KEY, or FILES_ENVELOPE_KEY). Existing plaintext
     * objects stay readable. Signed object-store redirects are skipped while
     * this is on so browsers never receive ciphertext.
     */
    'envelope_encrypt' => filter_var(env('FILES_ENVELOPE_ENCRYPT', true), FILTER_VALIDATE_BOOLEAN),

    'envelope_key' => env('FILES_ENVELOPE_KEY', ''),

    /*
     * Upload malware scan. `none` leaves files clean so local and tests do
     * not wait on a daemon. Production: MALWARE_SCANNER=clamav.
     */
    'malware_scanner' => env('MALWARE_SCANNER', 'none'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => rtrim(env('APP_URL', 'http://localhost'), '/').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            // Cloudflare R2 (Laravel Cloud's backing store) rejects the CRC32
            // integrity headers aws-sdk-php >= 3.337 sends by default. Only send
            // checksums when the API requires them so uploads succeed on R2.
            'request_checksum_calculation' => env('AWS_REQUEST_CHECKSUM_CALCULATION', 'when_required'),
            'response_checksum_validation' => env('AWS_RESPONSE_CHECKSUM_VALIDATION', 'when_required'),
            'throw' => false,
            'report' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
