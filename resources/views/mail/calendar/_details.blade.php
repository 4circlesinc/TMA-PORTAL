{{-- The when/where block, shared by every calendar mail so an invitation and
     the change notice that follows it describe the event identically. --}}
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;">
  <tr>
    <td style="font-size:13px;line-height:20px;color:#6b7280;padding:0 12px 6px 0;vertical-align:top;width:70px;">When</td>
    <td style="font-size:14px;line-height:22px;color:#0f1115;padding:0 0 6px;">
      <strong>{{ $whenLabel }}</strong>
      @if (! empty($timezoneLabel))
        <br><span style="font-size:12px;color:#6b7280;">{{ $timezoneLabel }}</span>
      @endif
    </td>
  </tr>
  @if (! empty($location))
    <tr>
      <td style="font-size:13px;line-height:20px;color:#6b7280;padding:0 12px 6px 0;vertical-align:top;">Where</td>
      <td style="font-size:14px;line-height:22px;color:#0f1115;padding:0 0 6px;">{{ $location }}</td>
    </tr>
  @endif
  @if (! empty($organizer))
    <tr>
      <td style="font-size:13px;line-height:20px;color:#6b7280;padding:0 12px 6px 0;vertical-align:top;">Organizer</td>
      <td style="font-size:14px;line-height:22px;color:#0f1115;padding:0 0 6px;">{{ $organizer }}</td>
    </tr>
  @endif
  @if (! empty($calendarName))
    <tr>
      <td style="font-size:13px;line-height:20px;color:#6b7280;padding:0 12px 6px 0;vertical-align:top;">Calendar</td>
      <td style="font-size:14px;line-height:22px;color:#0f1115;padding:0 0 6px;">{{ $calendarName }}</td>
    </tr>
  @endif
</table>

@if (! empty($description))
  <div style="border-left:3px solid #e6e8ec;padding:2px 0 2px 14px;margin:0 0 20px;">
    <p style="font-size:14px;line-height:22px;margin:0;color:#374151;white-space:pre-wrap;">{{ $description }}</p>
  </div>
@endif
