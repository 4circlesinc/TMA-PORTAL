{{-- Back / continue for a wizard step. $label overrides the primary button. --}}
<div class="tma-auth__nav-actions">
  <button type="submit" class="tma-auth__submit tma-auth__submit--continue">{{ $label ?? 'Continue' }}</button>
</div>
@if ($previous)
  <p class="tma-auth__alt-link">
    <button type="submit" form="onboarding-back" class="tma-auth__link-btn">Back</button>
  </p>
@endif
