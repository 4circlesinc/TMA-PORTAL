<?php

namespace App\Http\Controllers\Design;

use App\Http\Controllers\Controller;
use App\Support\Access\Role;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The email "postcard" documentation gallery at /design/mail. A staff-only page
 * that renders every template from the real design system
 * (public/js/email-templates.js — the same source /email/templates uses) so the
 * firm can review and approve them in one place before they're wired to sends.
 *
 * The rendering happens client-side against the actual template JS + portal CSS;
 * this controller only serves the gated shell.
 */
class MailPreviewController extends Controller
{
    /** Only the firm's own people may browse the gallery. */
    private const STAFF = ['Administrator', 'Employee'];

    public function index(Request $request)
    {
        abort_unless(
            Role::isStaff($request->user()),
            Response::HTTP_FORBIDDEN,
            'The email gallery is staff-only.'
        );

        return view('design.mail.index');
    }
}
