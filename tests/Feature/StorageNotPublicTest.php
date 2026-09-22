<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * storage/app/public is reachable from the web root through the public/storage
 * symlink, and it holds avatars, signature images and CIP passport photos.
 *
 * Production nginx refuses the prefix outright (see the comment block in
 * docker/nginx/templates/app.conf.template, which records that an earlier
 * revision was verified serving passport photos 200 with no session), and
 * public/.htaccess now does the same for Apache. Neither of those is
 * exercisable from PHPUnit; what IS exercisable is Laravel's own
 * storage.local route, which is the only path that should ever answer.
 */
class StorageNotPublicTest extends TestCase
{
    public function test_an_unsigned_storage_request_is_refused(): void
    {
        $this->get('/storage/cip/passport-photos/'.str_repeat('a', 8).'.png')
            ->assertStatus(app()->environment('production') ? 404 : 403);
    }

    public function test_the_avatar_disk_does_not_default_to_the_web_root(): void
    {
        $this->assertNotSame(
            'public',
            config('filesystems.avatar_disk'),
            'AVATAR_DISK must not default to the disk that publishes uploads.',
        );
    }
}
