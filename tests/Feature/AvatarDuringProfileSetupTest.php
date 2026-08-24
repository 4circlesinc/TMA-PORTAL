<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The profile-setup screen shows the photo we pulled from the person's
 * Google/Microsoft account, served from /media/avatars/…. That route used to
 * sit inside the portal's middleware group, so 'profile.complete' bounced it
 * back to the setup page: the <img> received HTML and the brand-new account
 * was greeted by a broken-image question mark where its photo should be.
 */
class AvatarDuringProfileSetupTest extends TestCase
{
    use RefreshDatabase;

    /** Put a real JPEG on the avatar disk and return its stored name. */
    private function storeAvatar(): string
    {
        $disk = config('filesystems.avatar_disk', 'public');
        Storage::fake($disk);

        $im = imagecreatetruecolor(8, 8);
        ob_start();
        imagejpeg($im);
        $jpeg = (string) ob_get_clean();

        $name = Str::uuid()->toString().'.jpg';
        Storage::disk($disk)->put('avatars/'.$name, $jpeg);

        return $name;
    }

    public function test_new_social_account_can_load_its_provider_photo_before_finishing_setup(): void
    {
        $name = $this->storeAvatar();

        // Exactly the state SocialAuthController leaves a first-time Microsoft
        // or Google sign-up in: verified, photo stored, profile not yet filled.
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::EMPLOYEE,
            'email_verified_at' => now(),
            'profile_completed_at' => null,
            'onboarding_completed_at' => null,
            'avatar_url' => '/media/avatars/'.$name,
            'provider_avatar_url' => '/media/avatars/'.$name,
        ]);

        $response = $this->actingAs($user)->get('/media/avatars/'.$name);

        $response->assertOk();
        $response->assertHeader('Content-Type', 'image/jpeg');
        $this->assertNotSame('', $response->streamedContent());
    }

    public function test_avatars_still_require_a_signed_in_visitor(): void
    {
        $name = $this->storeAvatar();

        // 401 rather than a login redirect: a redirect would park the image URL
        // as url.intended and send a fresh registrant to a raw JPEG after signup.
        $this->get('/media/avatars/'.$name)->assertUnauthorized();
    }
}
