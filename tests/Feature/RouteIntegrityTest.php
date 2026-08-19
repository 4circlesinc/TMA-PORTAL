<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Every registered route must point at a controller that exists.
 *
 * routes/web.php imports its controllers by hand, and `Something::class` on a
 * name with no `use` line silently resolves to a bare string — the route
 * registers fine and then 500s on every request. That is exactly how every
 * avatar in the portal broke: an edit replaced the AvatarController import
 * with the alphabetically-adjacent AvailabilityController, and nothing
 * noticed until production consoles filled with failed images.
 */
class RouteIntegrityTest extends TestCase
{
    public function test_every_route_action_resolves_to_a_real_controller_method(): void
    {
        $broken = [];

        foreach (Route::getRoutes() as $route) {
            $controller = $route->getAction('controller');

            if ($controller === null) {
                continue; // closures and view routes
            }

            [$class, $method] = array_pad(explode('@', $controller, 2), 2, '__invoke');

            if (! class_exists($class)) {
                $broken[] = $route->uri().' → '.$class.' (class missing — check the use lines in routes/web.php)';

                continue;
            }

            if (! method_exists($class, $method)) {
                $broken[] = $route->uri().' → '.$controller.' (method missing)';
            }
        }

        $this->assertSame([], $broken, "Routes pointing at nothing:\n".implode("\n", $broken));
    }
}
