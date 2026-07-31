{{--
  What the invitation is offering, shown on every live state of the invite
  screen: who sent it, which organization it is for, and what access it grants.
  Phase 2 requires all three before anyone is asked to create an account.
--}}
<div class="summary">
  <dl>
    <dt>Organization</dt>
    <dd>{{ $organisation }}</dd>

    @if ($inviter)
      <dt>Invited by</dt>
      <dd>{{ $inviter }}</dd>
    @endif

    @if ($offer)
      <dt>Access</dt>
      <dd>{{ $offer }}</dd>
    @endif

    @if ($target && $target !== $organisation && $target !== 'the portal')
      <dt>Account</dt>
      <dd>{{ $target }}</dd>
    @endif

    <dt>Email</dt>
    <dd>{{ $email }}</dd>
  </dl>
</div>
