{{-- Same chrome as getting-started: "1 of 3 complete", not "Step 1 of 3". --}}
<div class="tma-auth__progress" aria-hidden="true">
  <div class="tma-auth__progress-row">
    <span><strong>{{ $index }} of {{ $total }}</strong> complete</span>
    <span></span>
  </div>
  <div class="tma-auth__progress-track">
    <div class="tma-auth__progress-fill" style="width: {{ (int) round($index / max($total, 1) * 100) }}%;"></div>
  </div>
</div>
