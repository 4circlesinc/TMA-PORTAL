{{-- Right-click / image-drag friction for every standalone page (sign-in,
     share, sign, request, invites, the mail window). Mirrors
     PortalShell::lockdownTag() for the SPA shell: administrators get no
     script, which is their way back to the browser's own menus. Signed-out
     readers are not administrators, so the sign-in page is locked too. --}}
@unless (auth()->check() && \App\Support\Access\Role::isAdmin(auth()->user()))
  <script src="/js/ui-lockdown.js?v=4"></script>
@endunless
