{{--
  What the invitation is offering, shown on every live state of the invite
  screen: who sent it, which organization it is for, and what access it grants.
  Phase 2 requires all three before anyone is asked to create an account.

  Rendered as the same subtitle lines the sign-in and sign-up pages use.
--}}
@if ($inviter)
  <p class="tma-auth__subtitle">{{ $inviter }} invited you to {{ $organisation }}.</p>
@elseif ($organisation)
  <p class="tma-auth__subtitle">You have been invited to {{ $organisation }}.</p>
@endif

@if ($offer)
  <p class="tma-auth__subtitle">
    {{ $offer }}@if ($target && $target !== $organisation && $target !== 'the portal') · {{ $target }}@endif
  </p>
@endif
