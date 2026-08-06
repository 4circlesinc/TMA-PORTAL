{{-- A field's validation message. Always a sibling of the field, never inside
     it: .tma-auth__field is the 40px input pill itself, so anything nested in
     it lands on the same line as the input. --}}
@error($field)
  <p class="tma-auth__field-msg">
    <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
    <span>{{ $message }}</span>
  </p>
@enderror
