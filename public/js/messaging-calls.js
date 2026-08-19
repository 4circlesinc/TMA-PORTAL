/*
 * TMA - Voice/video calls for Messages (WebRTC + conversation signalling).
 * Global: window.TMAMessagingCalls
 *
 * ── The one idea this file is built on ──────────────────────────────────
 * There is exactly **one call**: one peer connection, one local stream, one
 * remote stream, one timer, one set of mute/camera flags. Everything the user
 * can see — the answer pop-up, the large modal, the bottom-left compact
 * window, the Dynamic Island — is a *presentation* of that single session.
 * Changing presentation re-renders a shell and moves one persistent media
 * element into it; it never touches the connection, the streams, or the timer.
 * That is what makes "minimize" and "expand" free, and why muting in one mode
 * is muted in all of them: there is nothing to keep in sync, because there is
 * only one of everything.
 *
 * Modes: incoming → (modal | compact | island). `prevMode` remembers where a
 * call was before it was expanded, so minimizing returns it there rather than
 * to a hardcoded layout.
 *
 * ── Two decisions worth knowing before changing anything ────────────────
 *
 * **Both media lines exist from the first offer.** `ensurePeer()` adds an
 * audio *and* a video transceiver even for a voice call, and switching between
 * voice and video is `replaceTrack()` on a sender that is already negotiated.
 * Nothing here ever renegotiates, so voice→video→voice cannot drop the call,
 * cannot glare, and cannot need a second permission prompt.
 *
 * **The pre-answer preview stream is not the call.** It is a local-only
 * `getUserMedia` stream so the callee can see themselves before answering; it
 * is never added to the peer connection. Answering hands those same tracks to
 * the call, which is why answering does not ask for the camera twice — and
 * declining stops them without the caller ever having seen anything.
 *
 * Signalling is race-tolerant: remote ICE that lands before a remote
 * description is buffered and flushed after it, "Accept" works before the
 * offer arrives (the answer is created the moment it does), and every signal
 * carries a `signalId` because it is delivered on both the conversation
 * channel and the recipient's own channel (see App\Events\CallSignal).
 */
(function () {
  'use strict';

  var ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  var session = null;
  var overlay = null;
  var mediaLayer = null;   // persistent: survives every mode change
  var audioSink = null;    // the remote sound; parked in the page and never moved
  var wired = false;       // delegated listeners are attached once, to `overlay`

  var MODES = { INCOMING: 'incoming', MODAL: 'modal', COMPACT: 'compact', ISLAND: 'island' };

  /*
   * Rendering is reconciliation, not replacement.
   *
   * Every render used to be `host.innerHTML = html`, which throws the whole
   * call away and builds it again: the avatar re-requests and flashes, the
   * window replays its entry animation, and the video element is torn out of
   * the document and put back. A connection-quality sample lands every four
   * seconds, so a live call visibly blinked at rest — as if it were reloading
   * itself. patch() updates the existing tree in place instead, so a state
   * change that touches one word touches one word and nothing else moves.
   *
   * Resolved per call rather than captured: dom-morph.js is a separate script,
   * and a call must not depend on which of the two loaded first.
   */
  var MORPH_FALLBACK = { patch: function (root, html) { root.innerHTML = html; } };
  function morph() { return window.TMAMorph || MORPH_FALLBACK; }

  /* Where the island sits. Six anchors, cycled by its move handle. */
  var PILL_POSITIONS = ['tc', 'tr', 'br', 'bc', 'bl', 'tl'];

  function readStore(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode — ignore */ }
  }

  var pillPos = readStore('tma.call.pillPos', 'tc');

  /*
   * Preferred devices are remembered on the machine they describe, not on the
   * account: a camera id from this laptop means nothing on the user's phone.
   * The *display* preference is the opposite — it is about how the user likes
   * to work, so it lives on the account (MessagingSettings.callDisplay).
   */
  function readDevicePrefs() {
    try {
      var raw = localStorage.getItem('tma.call.devices');
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  }
  function writeDevicePrefs(prefs) {
    try { localStorage.setItem('tma.call.devices', JSON.stringify(prefs || {})); } catch (e) { /* ignore */ }
  }

  /* The signed-in user's id, learned from the realtime binding / signalling. */
  var meId = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function api() { return window.TMAMessagingAPI; }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function callKindLabel(media) {
    return media === 'video' ? 'Video call' : 'Voice call';
  }

  /* The display mode an answered call should land in (§15). */
  function defaultMode() {
    var pref = (window.TMAMessagingSettings && window.TMAMessagingSettings.callDisplay) ||
      readStore('tma.call.display', MODES.ISLAND);
    return pref === MODES.MODAL || pref === MODES.COMPACT || pref === MODES.ISLAND
      ? pref : MODES.ISLAND;
  }

  /* ------------------------------------------------------------------ *
   * Ringing
   *
   * One looping element for the whole module, started when a call begins to
   * ring at either end and stopped from closeOverlay() — every path that ends
   * a call goes through there, so none of them can leave it playing.
   *
   * The tone is the user's choice, handed over by messages.js in
   * window.TMAMessagingSettings; 'none', or notification sounds switched off,
   * means the call still rings on screen, just not out loud.
   * ------------------------------------------------------------------ */

  var RINGTONES = {
    'ringtone-1': 'audio/ringtone-1.mp3',
    'ringtone-2': 'audio/ringtone-2.mp3',
  };

  var ringEl = null;

  function ringtoneSrc() {
    var prefs = window.TMAMessagingSettings || {};
    if (prefs.notificationSounds === false) return null;
    var key = prefs.ringtone || 'ringtone-1';
    if (key === 'none') return null;
    return RINGTONES[key] || RINGTONES['ringtone-1'];
  }

  function startRinging() {
    stopRinging();
    var src = ringtoneSrc();
    if (!src) return;

    try {
      ringEl = new Audio(src);
      ringEl.loop = true;
      ringEl.volume = 0.7;

      // Ring out of the device the user picked for calls, where the browser
      // allows a page to choose at all.
      var speaker = readDevicePrefs().speaker;
      if (speaker && typeof ringEl.setSinkId === 'function') {
        ringEl.setSinkId(speaker).catch(function () { /* keep the default output */ });
      }

      var played = ringEl.play();
      // Autoplay policy can refuse this on an incoming call if the page has
      // not been touched yet. The pop-up is still on screen, which is the part
      // that matters; a silent ring is not an error to report.
      if (played && played.catch) played.catch(function () { /* ignore */ });
    } catch (e) {
      ringEl = null;
    }
  }

  function stopRinging() {
    // A call that has stopped ringing has also stopped being an unanswered
    // incoming one, so the OS notification goes with it — every accept, decline
    // and hangup path already funnels through here or through closeOverlay().
    closeCallNotification();
    if (!ringEl) return;
    try {
      ringEl.pause();
      ringEl.currentTime = 0;
    } catch (e) { /* ignore */ }
    ringEl = null;
  }

  /* ------------------------------------------------------------------ *
   * Desktop notification (an incoming call, when the tab is not in front)
   *
   * The on-screen pop-up and ringtone already cover a focused tab; this is for
   * the case that actually needs it — the call rung in while the user was in
   * another tab or another app. Closed the moment the call stops ringing.
   * ------------------------------------------------------------------ */

  var callNotification = null;

  function notificationsAllowed() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    // Respect the user's Messages preference; default on when it is unknown,
    // because a ringing call is exactly what a person expects to be told about.
    var prefs = window.TMAMessagingSettings || {};
    return prefs.desktopNotifications !== false;
  }

  function showCallNotification(sess) {
    closeCallNotification();
    if (!sess || !notificationsAllowed()) return;
    // The desktop app rings in its own panel, with Accept and Decline on it.
    // A notification alongside would be the same call announced twice.
    if (window.TMADesktop && window.TMADesktop.isDesktop) return;
    // Focused tab: the pop-up is already on screen and ringing.
    if (typeof document.hasFocus === 'function' && document.hasFocus()) return;

    try {
      var isVideo = sess.media === 'video';
      callNotification = new Notification(sess.peerName, {
        body: 'Incoming ' + (isVideo ? 'video call' : 'voice call') + '…',
        tag: 'tma-call-' + sess.conversationId,
        icon: sess.peerAvatar || undefined,
        // Keep it up until acted on — a call is not a fire-and-forget alert.
        requireInteraction: true,
        renotify: true,
      });
      callNotification.onclick = function () {
        try { window.focus(); } catch (e) { /* ignore */ }
        closeCallNotification();
      };
    } catch (e) {
      callNotification = null;
    }
  }

  function closeCallNotification() {
    if (!callNotification) return;
    try { callNotification.close(); } catch (e) { /* ignore */ }
    callNotification = null;
  }

  /* ------------------------------------------------------------------ *
   * Permission priming
   *
   * A real call must never stop to ask: camera, microphone and notification
   * permission are all requested once, up front, from the first interaction on
   * the Messages page. The media grant is persistent, so after this the
   * pre-answer preview and getUserMedia never prompt again; a stored flag keeps
   * the whole thing to a single occurrence per browser.
   * ------------------------------------------------------------------ */

  var PRIME_KEY = 'tma.call.primed';
  var primeArmed = false;

  function primeCallEnvironment() {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        var p = Notification.requestPermission();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) { /* older callback-only API — the toggle in settings still works */ }

    if (readStore(PRIME_KEY, '') === '1' || mediaUnsupported()) return;

    var granted = function () { writeStore(PRIME_KEY, '1'); };
    navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      .then(function (stream) { stopStream(stream); granted(); })
      .catch(function (err) {
        var name = err && err.name;
        // No camera on this machine? Still secure the microphone so voice calls
        // never prompt. A denial, by contrast, is a real choice — leave the flag
        // unset so a later deliberate call can still raise the browser prompt.
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
          navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function (stream) { stopStream(stream); granted(); })
            .catch(function () { /* denied or nothing there — the call will explain */ });
        }
      });
  }

  function armPermissionPrimer() {
    if (primeArmed) return;
    primeArmed = true;
    var fire = function () {
      document.removeEventListener('pointerdown', fire, true);
      document.removeEventListener('keydown', fire, true);
      primeCallEnvironment();
    };
    document.addEventListener('pointerdown', fire, true);
    document.addEventListener('keydown', fire, true);
  }

  /* ------------------------------------------------------------------ *
   * Session lifecycle
   * ------------------------------------------------------------------ */

  function newSession(attrs) {
    var devices = readDevicePrefs();
    return Object.assign({
      conversationId: null,
      media: 'audio',
      role: 'caller',
      initiatorId: null,
      peerName: 'Contact',
      peerAvatar: null,

      pc: null,
      localStream: null,
      remoteStream: null,
      previewStream: null,
      audioSender: null,
      videoSender: null,
      candidates: [],
      remoteOffer: null,
      answered: false,
      accepting: false,
      connected: false,
      startedAt: null,
      timer: null,
      statsTimer: null,
      ringTimer: null,

      muted: false,
      cameraOff: false,
      // What the far end says about itself. Assumed on until told otherwise,
      // so a peer that never reports does not look permanently camera-off.
      remoteMuted: false,
      remoteCameraOff: false,

      // Screen sharing, ours and theirs. The screen stream is kept apart from
      // localStream so stopping a share can never take the camera with it.
      screenSharing: false,
      screenStream: null,
      remoteScreenSharing: false,

      // Client-call recording (§ maybeStartRecording): `recording` is the live
      // recorder bundle on the side that records; `remoteRecording` means the
      // far end said it is recording. The notice shows for either; dismissing
      // it hides the sentence, never the REC chip.
      recording: null,
      remoteRecording: false,
      recordingNoticeDismissed: false,

      mode: MODES.INCOMING,
      prevMode: null,
      swapped: false,
      localPos: null,
      compactPos: null,
      quality: null,
      statusText: '',
      error: null,
      upgrade: null,        // { direction: 'out'|'in' }
      sheet: null,          // 'devices' | 'more' | null
      devices: {
        camera: devices.camera || null,
        microphone: devices.microphone || null,
        speaker: devices.speaker || null,
      },
      deviceList: null,
      seen: {},
      announced: '',
    }, attrs || {});
  }

  function stopTimer() {
    if (!session) return;
    if (session.timer) { clearInterval(session.timer); session.timer = null; }
    if (session.statsTimer) { clearInterval(session.statsTimer); session.statsTimer = null; }
    if (session.ringTimer) { clearTimeout(session.ringTimer); session.ringTimer = null; }
  }

  /*
   * An unanswered call gives up on its own: 15 seconds of ringing, then the
   * caller's side ends it as a missed call rather than ringing into the
   * void. The callee runs the same clock at double length as a failsafe —
   * normally the caller's hangup closes the pop-up, but a caller whose tab
   * died mid-ring can never send it.
   */
  var RING_TIMEOUT_MS = 15000;

  function armRingTimeout() {
    if (!session) return;
    clearRingTimeout();
    var caller = session.role === 'caller';
    session.ringTimer = setTimeout(function () {
      if (!session || session.connected || session.accepting || session.answered) return;
      if (caller) {
        if (window.TMAToast && window.TMAToast.show) window.TMAToast.show('No answer');
        announce('No answer');
        endSession(true); // hangup, answered:false — recorded as missed
        return;
      }
      // The vanished-caller failsafe: close quietly, no signal — there is
      // nobody left to hear a reject.
      stopRinging();
      stopRecording();
      teardownMedia();
      session = null;
      closeOverlay();
    }, caller ? RING_TIMEOUT_MS : RING_TIMEOUT_MS * 2);
  }

  function clearRingTimeout() {
    if (session && session.ringTimer) { clearTimeout(session.ringTimer); session.ringTimer = null; }
  }

  function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach(function (t) {
      try { t.stop(); } catch (e) { /* ignore */ }
    });
  }

  function teardownMedia() {
    if (!session) return;
    stopStream(session.localStream);
    // The preview may share tracks with the local stream once answered; stop()
    // twice is harmless, and missing one leaves the camera light on.
    stopStream(session.previewStream);
    stopStream(session.screenStream);
    if (session.pc) {
      try { session.pc.close(); } catch (e) { /* ignore */ }
    }
  }

  /* ------------------------------------------------------------------ *
   * Host bridge
   *
   * The desktop shell runs this page in an isolated world: it shares the DOM
   * but not our globals, so it cannot see `session`. Publishing the phase onto
   * <html> lets it ring the dock and hold off display sleep the way a native
   * call app does. In a browser nothing reads it and nothing changes.
   * ------------------------------------------------------------------ */
  function publishCallPhase() {
    var el = document.documentElement;
    var phase = '';
    if (session) phase = session.mode === MODES.INCOMING ? 'ringing' : 'active';

    // The desktop shell rings in its own small window rather than opening the
    // app, so it needs to know who is calling. Written before the phase flips,
    // because that is what the shell reads on.
    if (phase === 'ringing') {
      try {
        el.setAttribute('data-tma-call-info', JSON.stringify({
          name: session.peerName || 'Unknown caller',
          avatar: session.peerAvatar || '',
          media: session.media || 'audio',
        }));
      } catch (e) { /* a shell that cannot read it just shows less */ }
    } else {
      el.removeAttribute('data-tma-call-info');
    }

    if (el.getAttribute('data-tma-call') === phase) return;
    if (phase) el.setAttribute('data-tma-call', phase);
    else el.removeAttribute('data-tma-call');
  }

  function closeOverlay() {
    stopRinging();
    document.documentElement.removeAttribute('data-tma-call');
    releaseFocus();
    // The window belongs to the call, not the other way round: when the call
    // is over the window goes with it, without being read as "stop floating".
    closeFloat(false);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    if (audioSink && audioSink.parentNode) audioSink.parentNode.removeChild(audioSink);
    audioSink = null;
    mediaLayer = null;
    wired = false;
  }

  function endSession(sendHangup) {
    stopMeter();
    if (!session) { closeOverlay(); return; }
    // The recorder must be told to stop before pc.close() kills the remote
    // tracks, or the final chunk of the recording is lost with them.
    stopRecording();
    if (sendHangup) signal('hangup', {
      media: session.media,
      initiatorId: session.initiatorId || meId || null,
      answered: !!session.connected,
    });
    stopTimer();
    teardownMedia();
    session = null;
    closeOverlay();
  }

  /* Fire-and-forget signalling. A failed relay must never break the call UI. */
  function signal(type, extra) {
    if (!session || !api()) return Promise.resolve();
    var body = Object.assign({ type: type }, extra || {});
    if (!body.media) body.media = session.media;
    return api().callSignal(session.conversationId, body).catch(function () {});
  }

  /* Tell the other end what our microphone and camera are doing (§4) — and
   * whether we are sharing a screen or recording, which they cannot see. */
  function publishState() {
    signal('state', {
      payload: {
        muted: !!session.muted,
        cameraOff: !!session.cameraOff,
        media: session.media,
        screenSharing: !!session.screenSharing,
        recording: !!session.recording,
      },
    });
  }

  /* ------------------------------------------------------------------ *
   * Media
   * ------------------------------------------------------------------ */

  function mediaUnsupported() {
    return !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia;
  }

  function constraintsFor(wantVideo) {
    var d = (session && session.devices) || {};
    var audio = d.microphone ? { deviceId: { ideal: d.microphone } } : true;
    if (!wantVideo) return { audio: audio, video: false };
    var video = d.camera ? { deviceId: { ideal: d.camera } } : true;
    return { audio: audio, video: video };
  }

  function getMedia(wantVideo) {
    if (mediaUnsupported()) {
      var err = new Error('Calls need a secure (https) connection');
      err.name = 'InsecureContext';
      return Promise.reject(err);
    }
    return navigator.mediaDevices.getUserMedia(constraintsFor(wantVideo));
  }

  /*
   * Turn a getUserMedia rejection into something a person can act on (§23).
   * The distinction that matters is "you said no" (fixable in the browser)
   * versus "there is nothing there" (fixable by plugging something in) versus
   * "something else has it" — each has a different next step.
   */
  function describeMediaError(err, wantVideo) {
    var name = (err && err.name) || '';
    var thing = wantVideo ? 'Camera' : 'Microphone';
    // `media: true` is what earns an error its recovery actions. Every failure
    // to reach a device is recoverable in the same three ways — try again,
    // choose a different device, or carry on without it — so the actions hang
    // off the category rather than off each individual error name.
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return {
        title: thing + ' permission denied',
        message: 'Your browser is blocking access. Allow it from the address bar, then try again.',
        kind: 'permission', media: true, wantVideo: wantVideo,
      };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return {
        title: 'No ' + thing.toLowerCase() + ' found',
        message: 'Nothing is connected, or the device you picked is gone. Choose another in device settings.',
        kind: 'missing', media: true, wantVideo: wantVideo,
      };
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return {
        title: thing + ' unavailable',
        message: 'Another application is using it. Close that and try again.',
        kind: 'busy', media: true, wantVideo: wantVideo,
      };
    }
    if (name === 'InsecureContext' || name === 'NotSupportedError') {
      return {
        title: 'This browser cannot use the ' + thing.toLowerCase(),
        message: 'Calls need a secure (https) connection and a browser with camera and microphone support.',
        kind: 'unsupported', media: true, wantVideo: wantVideo,
      };
    }
    return {
      title: 'Could not start the ' + thing.toLowerCase(),
      message: 'Check that it is connected and not in use by another application, then try again.',
      kind: 'unknown', media: true, wantVideo: wantVideo,
    };
  }

  function enumerateDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return Promise.resolve({ camera: [], microphone: [], speaker: [] });
    }
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      var out = { camera: [], microphone: [], speaker: [] };
      list.forEach(function (d, i) {
        var entry = { id: d.deviceId, label: d.label || '' };
        if (d.kind === 'videoinput') {
          entry.label = entry.label || 'Camera ' + (out.camera.length + 1);
          out.camera.push(entry);
        } else if (d.kind === 'audioinput') {
          entry.label = entry.label || 'Microphone ' + (out.microphone.length + 1);
          out.microphone.push(entry);
        } else if (d.kind === 'audiooutput') {
          entry.label = entry.label || 'Speaker ' + (out.speaker.length + 1);
          out.speaker.push(entry);
        }
      });
      return out;
    }).catch(function () {
      return { camera: [], microphone: [], speaker: [] };
    });
  }

  function loadDeviceList() {
    return enumerateDevices().then(function (list) {
      if (session) session.deviceList = list;
      render();
      return list;
    });
  }

  function supportsSinkId() {
    var el = document.createElement('audio');
    return typeof el.setSinkId === 'function';
  }

  function applySpeaker() {
    if (!session || !session.devices.speaker) return;
    var audio = audioSink;
    if (!audio || typeof audio.setSinkId !== 'function') return;
    audio.setSinkId(session.devices.speaker).catch(function () { /* ignore */ });
  }

  /*
   * Swap one input device mid-call without touching the connection (§22).
   * The new track is pushed into the existing sender, so the far end sees the
   * picture change with no renegotiation and no interruption.
   */
  function switchDevice(kind, deviceId) {
    if (!session) return Promise.resolve();
    session.devices[kind] = deviceId || null;
    var prefs = readDevicePrefs();
    prefs[kind] = deviceId || null;
    writeDevicePrefs(prefs);

    if (kind === 'speaker') { applySpeaker(); render(); return Promise.resolve(); }

    // Preview (before answering) has no senders — just rebuild the preview.
    if (session.mode === MODES.INCOMING) {
      return startPreview(session.previewWantsVideo !== false);
    }

    var wantVideo = kind === 'camera';
    if (wantVideo && (session.media !== 'video' || session.cameraOff)) { render(); return Promise.resolve(); }

    var constraints = wantVideo
      ? { video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false }
      : { audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false };

    return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      if (!session) { stopStream(stream); return; }
      var track = wantVideo ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
      if (!track) { stopStream(stream); return; }

      var sender = wantVideo ? session.videoSender : session.audioSender;
      var old = session.localStream && (wantVideo
        ? session.localStream.getVideoTracks()[0]
        : session.localStream.getAudioTracks()[0]);

      // A live screen share owns the video sender; the new camera waits in
      // localStream and takes the wire back when the share stops.
      if (sender && !(wantVideo && session.screenSharing)) {
        sender.replaceTrack(track).catch(function () { /* ignore */ });
      }
      if (session.localStream) {
        if (old) { session.localStream.removeTrack(old); try { old.stop(); } catch (e) { /* ignore */ } }
        session.localStream.addTrack(track);
      }
      if (!wantVideo) {
        track.enabled = !session.muted;
        // A live recording mixes the ORIGINAL microphone track; stopping it
        // above turned that source to silence, so hand it the new one.
        rewireRecorderLocalAudio(track);
      } else {
        track.enabled = !session.cameraOff;
      }
      attachStreams();
      render();
    }).catch(function (err) {
      showError(describeMediaError(err, wantVideo));
    });
  }

  /* ------------------------------------------------------------------ *
   * Peer connection
   * ------------------------------------------------------------------ */

  function flushCandidates() {
    if (!session || !session.pc || !session.candidates) return;
    var pc = session.pc;
    if (!pc.remoteDescription || !pc.remoteDescription.type) return;
    var queued = session.candidates;
    session.candidates = [];
    queued.forEach(function (candidate) {
      pc.addIceCandidate(candidate).catch(function () {});
    });
  }

  /*
   * Coerce whatever arrived over the wire into a clean { type, sdp } dict.
   * The SDP survives a JSON round-trip fine, but the *wrapper* can drift: it
   * may arrive as a JSON string, or double-nested as { sdp: { type, sdp } } —
   * which makes the browser stringify an object to "[object Object]" and throw
   * "Invalid SDP line".
   */
  function toDescription(raw, fallbackType) {
    var desc = raw;
    if (typeof desc === 'string') {
      try { desc = JSON.parse(desc); } catch (e) { return null; }
    }
    if (!desc || typeof desc !== 'object') return null;
    if (desc.sdp && typeof desc.sdp === 'object') desc = desc.sdp;
    if (typeof desc.sdp !== 'string' || !desc.sdp) return null;

    // SDP must be `x=value` lines separated by CRLF with no blanks; a round
    // trip can leave stray lone CRs or doubled newlines the parser rejects.
    var sdp = desc.sdp
      .split(/[\r\n]+/)
      .filter(function (line) { return line.length > 0; })
      .join('\r\n') + '\r\n';

    return { type: desc.type || fallbackType, sdp: sdp };
  }

  function ensurePeer() {
    if (session.pc) return session.pc;
    var pc = new RTCPeerConnection(ICE);
    session.pc = pc;
    session.remoteStream = new MediaStream();

    // Both media lines are negotiated up front, even for a voice call. This is
    // the whole reason voice↔video switching later is just replaceTrack().
    if (session.role === 'caller' && typeof pc.addTransceiver === 'function') {
      session.audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      session.videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
      pushLocalTracks();
    } else if (session.localStream) {
      // Callee before the offer lands, or a browser without addTransceiver:
      // add what we have and let adoptSenders() sort the mapping out after
      // setRemoteDescription.
      session.localStream.getTracks().forEach(function (track) {
        var sender = pc.addTrack(track, session.localStream);
        if (track.kind === 'audio') session.audioSender = sender;
        else session.videoSender = sender;
      });
    }

    pc.ontrack = function (ev) {
      (ev.streams[0] ? ev.streams[0].getTracks() : [ev.track]).forEach(function (t) {
        if (session.remoteStream.getTrackById(t.id)) return;
        session.remoteStream.addTrack(t);
      });
      attachStreams();
      render();
    };

    pc.onicecandidate = function (ev) {
      if (!ev.candidate) return;
      signal('ice', { payload: { candidate: ev.candidate.toJSON() } });
    };

    pc.onconnectionstatechange = function () {
      if (!session || session.pc !== pc) return;
      var st = pc.connectionState;
      if (st === 'connected') {
        // markConnected decides what an established connection resolves: a
        // connection error, yes; a missing microphone, no.
        markConnected();
      } else if (st === 'disconnected') {
        setStatus('Reconnecting…');
        session.quality = 'poor';
        render();
      } else if (st === 'failed') {
        showError({
          title: 'Connection lost',
          message: 'The call could not keep its connection.',
          kind: 'connection',
        });
      }
    };

    pc.oniceconnectionstatechange = function () {
      if (!session || session.pc !== pc) return;
      var st = pc.iceConnectionState;
      if (st === 'connected' || st === 'completed') markConnected();
    };

    return pc;
  }

  /* Put the current local tracks onto the negotiated senders. */
  function pushLocalTracks() {
    if (!session || !session.localStream) return;
    var audio = session.localStream.getAudioTracks()[0];
    var video = session.localStream.getVideoTracks()[0];
    if (session.audioSender && audio) session.audioSender.replaceTrack(audio).catch(function () {});
    if (session.videoSender) {
      session.videoSender.replaceTrack(session.media === 'video' ? (video || null) : null)
        .catch(function () {});
    }
  }

  /*
   * After setRemoteDescription the callee's transceivers exist and their
   * receivers report a kind — that is the only reliable moment to learn which
   * sender is which without having created them ourselves.
   */
  function adoptSenders() {
    if (!session || !session.pc || typeof session.pc.getTransceivers !== 'function') return;
    session.pc.getTransceivers().forEach(function (t) {
      var kind = (t.receiver && t.receiver.track && t.receiver.track.kind) ||
        (t.sender && t.sender.track && t.sender.track.kind);
      if (kind === 'audio' && !session.audioSenderFixed) { session.audioSender = t.sender; session.audioSenderFixed = true; }
      if (kind === 'video' && !session.videoSenderFixed) { session.videoSender = t.sender; session.videoSenderFixed = true; }
      if (t.direction === 'recvonly' || t.direction === 'inactive') {
        try { t.direction = 'sendrecv'; } catch (e) { /* ignore */ }
      }
    });
    pushLocalTracks();
  }

  function markConnected() {
    if (!session || session.connected) return;
    stopRinging();
    session.connected = true;
    session.startedAt = Date.now();
    // Connecting resolves a *connection* problem, not a device one: someone who
    // joined with a blocked microphone is now in a call nobody can hear them
    // in, and that is exactly when they need telling.
    if (session.error && !session.error.media) clearError();
    setStatus('');
    stopTimer();
    session.timer = setInterval(tickDuration, 1000);
    session.statsTimer = setInterval(sampleQuality, 4000);
    tickDuration();

    // An answered call goes to the display the user asked for (§15). Until
    // now the caller has been watching the modal ring, which is what they
    // wanted to see; once it is answered their preference takes over.
    session.prevMode = defaultMode();
    // …unless it is already floating in a window of its own, which outranks a
    // preference about where it should sit *in the page*.
    if (isFloating()) render();
    else if (session.mode !== defaultMode()) setMode(defaultMode(), { silent: true });
    else render();

    publishState();
    announce(callKindLabel(session.media) + ' connected');

    // Both streams are live from here — the one moment a client-call
    // recording can begin. The server decides whether this call is one.
    maybeStartRecording();
  }

  function tickDuration() {
    var host = hostEl();
    if (!session || !session.startedAt || !host) return;
    var text = formatDuration(Date.now() - session.startedAt);
    host.querySelectorAll('[data-call-duration]').forEach(function (n) { n.textContent = text; });
  }

  function formatDuration(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
  }

  /*
   * Connection quality, sampled rather than computed continuously: round-trip
   * time and packet loss from the last outbound report are enough to say
   * "good / fair / poor", which is all the badge claims.
   */
  function sampleQuality() {
    if (!session || !session.pc || typeof session.pc.getStats !== 'function') return;
    session.pc.getStats(null).then(function (stats) {
      if (!session) return;
      var rtt = null, loss = null;
      stats.forEach(function (r) {
        if (r.type === 'remote-inbound-rtp') {
          if (typeof r.roundTripTime === 'number') rtt = r.roundTripTime;
          if (typeof r.fractionLost === 'number') loss = r.fractionLost;
        }
        if (r.type === 'candidate-pair' && r.state === 'succeeded' &&
            typeof r.currentRoundTripTime === 'number' && rtt === null) {
          rtt = r.currentRoundTripTime;
        }
      });
      var next = 'good';
      if ((rtt !== null && rtt > 0.6) || (loss !== null && loss > 0.1)) next = 'poor';
      else if ((rtt !== null && rtt > 0.3) || (loss !== null && loss > 0.03)) next = 'fair';
      if (next !== session.quality) { session.quality = next; render(); }
    }).catch(function () { /* stats are a nicety, never a failure */ });
  }

  /* ------------------------------------------------------------------ *
   * Errors and announcements
   * ------------------------------------------------------------------ */

  function showError(info) {
    if (!session) return;
    // A call that has stopped going anywhere must stop ringing, or a failed
    // outgoing call rings on underneath its own error dialog.
    stopRinging();
    session.error = info;
    render();
    announce(info.title);
  }

  function clearError() {
    if (session && session.error) { session.error = null; render(); }
  }

  function setStatus(text) {
    if (!session) return;
    session.statusText = text;
    var host = hostEl();
    if (!host) return;
    host.querySelectorAll('[data-call-status]').forEach(function (n) { n.textContent = text; });
  }

  /* One assertive region so a screen reader hears the call, not the layout. */
  function announce(text) {
    var host = hostEl();
    if (!host || !text) return;
    var live = host.querySelector('[data-call-live]');
    if (!live || session.announced === text) return;
    session.announced = text;
    live.textContent = text;
  }

  /* ------------------------------------------------------------------ *
   * The persistent media layer
   *
   * Created once per call and moved between mode shells. The remote picture
   * and the remote *sound* are deliberately different elements: the video is
   * muted and only ever shows a picture, while a single always-present audio
   * element carries the sound. A mode that hides or shrinks the picture can
   * then never affect what the user hears, and speaker selection has one
   * stable element to apply to.
   * ------------------------------------------------------------------ */

  function buildMediaLayer() {
    if (mediaLayer) return mediaLayer;
    var el = document.createElement('div');
    el.className = 'tma-call__media';
    el.innerHTML =
      '<div class="tma-call__frame tma-call__frame--remote" data-call-frame="remote">' +
      '<video class="tma-call__video" data-call-remote autoplay playsinline muted></video>' +
      '<div class="tma-call__off" data-call-remote-off>' +
      '<span class="tma-call__off-avatar" data-call-remote-avatar></span>' +
      '<span class="tma-call__off-name" data-call-remote-name></span>' +
      '<span class="tma-call__off-badge">' + iconCameraOff() + '<span>Camera off</span></span>' +
      '</div>' +
      '<button type="button" class="tma-call__frame-swap" data-call-action="swap" ' +
      'aria-label="Swap the large and small video">' + iconSwap() + '</button>' +
      '<span class="tma-call__frame-tag" data-call-remote-tag></span>' +
      '</div>' +
      '<div class="tma-call__frame tma-call__frame--local" data-call-frame="local">' +
      '<video class="tma-call__video tma-call__video--mirror" data-call-local autoplay playsinline muted></video>' +
      '<div class="tma-call__off" data-call-local-off>' +
      '<span class="tma-call__off-avatar tma-call__off-avatar--me">You</span>' +
      '<span class="tma-call__off-badge">' + iconCameraOff() + '<span>Camera off</span></span>' +
      '</div>' +
      '<button type="button" class="tma-call__frame-swap" data-call-action="swap" ' +
      'aria-label="Swap the large and small video">' + iconSwap() + '</button>' +
      '<span class="tma-call__frame-tag">You</span>' +
      '</div>';
    mediaLayer = el;
    wireLocalDrag();
    return el;
  }

  /*
   * The remote *sound*, deliberately outside the media layer.
   *
   * The layer is re-parented for every presentation, and now into an entirely
   * different document when the call floats in its own window. Sound has to
   * survive all of that, so the one element carrying it is created once, parked
   * in the page, and never moved — a call cannot be silenced by a change of
   * scenery it never hears about.
   */
  function buildAudioSink() {
    if (audioSink && audioSink.parentNode) return audioSink;
    audioSink = document.createElement('audio');
    audioSink.setAttribute('data-call-audio', '');
    audioSink.autoplay = true;
    audioSink.style.display = 'none';
    document.body.appendChild(audioSink);
    return audioSink;
  }

  function localPicture() {
    // Order matters: a shared screen is what the far end is being shown, so
    // the self-view mirrors it; behind that, an in-progress video upgrade is
    // showing the user the camera they are about to share, which must win
    // over the live call stream that does not carry video yet.
    return session.screenStream || session.upgradePreview ||
      session.localStream || session.previewStream || null;
  }

  /*
   * Whether anything on this call is showing moving pictures — a camera call,
   * our shared screen, or theirs. Screen share deliberately never flips
   * session.media (that word means what the camera flow negotiated, and the
   * far end still expects camera semantics from it), so every layout decision
   * asks this instead.
   */
  function hasAnyVideo() {
    return !!session && (session.media === 'video' ||
      !!session.screenSharing || !!session.remoteScreenSharing);
  }

  function attachStreams() {
    if (!mediaLayer || !session) return;
    var local = mediaLayer.querySelector('[data-call-local]');
    var localStream = localPicture();
    if (local && localStream && local.srcObject !== localStream) {
      local.srcObject = localStream;
      local.play().catch(function () { /* autoplay policy — muted, so rare */ });
    }
    var remote = mediaLayer.querySelector('[data-call-remote]');
    if (remote && session.remoteStream && remote.srcObject !== session.remoteStream) {
      remote.srcObject = session.remoteStream;
      remote.play().catch(function () {});
    }
    var audio = buildAudioSink();
    if (audio && session.remoteStream && audio.srcObject !== session.remoteStream) {
      audio.srcObject = session.remoteStream;
      audio.play().catch(function () {});
      applySpeaker();
    }
  }

  /*
   * Moving the media layer between documents can leave its video elements
   * paused. They are muted, so asking them to play again is always permitted.
   */
  function resumeMedia() {
    if (!mediaLayer) return;
    mediaLayer.querySelectorAll('video').forEach(function (v) {
      if (v.srcObject && v.paused) v.play().catch(function () { /* ignore */ });
    });
    if (audioSink && audioSink.srcObject && audioSink.paused) {
      audioSink.play().catch(function () { /* ignore */ });
    }
  }

  /*
   * Reflect state onto the media layer without rebuilding it — this runs on
   * every render, and rebuilding would restart the video elements.
   */
  function syncMediaLayer() {
    if (!mediaLayer || !session) return;

    // A remote screen share is a live video track like any other, but it must
    // not be hidden by remoteCameraOff — the camera being off is exactly the
    // state a sharer is usually in.
    var remoteLive = !!(session.remoteStream && session.remoteStream.getVideoTracks().some(function (t) {
      return t.readyState === 'live';
    }));
    var remoteHasVideo = remoteLive && (session.remoteScreenSharing ||
      (session.media === 'video' && !session.remoteCameraOff));
    var picture = localPicture();
    var localHasVideo = session.screenSharing
      ? !!(picture && picture.getVideoTracks().length)
      : !session.cameraOff && !!(picture && picture.getVideoTracks().length) &&
        (session.media === 'video' || !!session.upgradePreview);

    mediaLayer.classList.toggle('is-swapped', !!session.swapped);
    mediaLayer.classList.toggle('has-remote-video', remoteHasVideo);
    mediaLayer.classList.toggle('has-local-video', localHasVideo);

    // A mirrored self-view is right for a face and wrong for a screen: text
    // in a mirrored share is backwards.
    var localVideo = mediaLayer.querySelector('[data-call-local]');
    if (localVideo) {
      localVideo.classList.toggle('tma-call__video--mirror', !session.screenSharing);
    }

    var big = session.swapped ? 'local' : 'remote';
    /*
     * The small window has room for exactly one picture, so it shows the best
     * one there is: the other person once they are on camera, and until then
     * your own preview. Without this a call spends the whole time it is ringing
     * showing a black rectangle — the camera is running, it is just in the
     * self-view, which this presentation hides.
     */
    if ((isFloating() || session.mode === MODES.COMPACT) && !remoteHasVideo && localHasVideo) {
      big = 'local';
    }
    mediaLayer.querySelectorAll('[data-call-frame]').forEach(function (f) {
      var isBig = f.getAttribute('data-call-frame') === big;
      f.classList.toggle('is-big', isBig);
      f.classList.toggle('is-pip', !isBig);
    });

    var avatar = mediaLayer.querySelector('[data-call-remote-avatar]');
    if (avatar) {
      // Written only when it actually changes. This runs on every render, and
      // rewriting the same photo makes the browser fetch and decode it again —
      // which is the other half of the flicker patch() was brought in to stop.
      var face = session.peerAvatar
        ? '<img src="' + esc(session.peerAvatar) + '" alt="" referrerpolicy="no-referrer">'
        : esc(initials(session.peerName));
      if (avatar.getAttribute('data-face') !== face) {
        avatar.setAttribute('data-face', face);
        avatar.innerHTML = face;
      }
      avatar.classList.toggle('tma-call__off-avatar--initials', !session.peerAvatar);
    }
    var nameEl = mediaLayer.querySelector('[data-call-remote-name]');
    if (nameEl) nameEl.textContent = session.peerName;
    var tag = mediaLayer.querySelector('[data-call-remote-tag]');
    if (tag) {
      tag.textContent = session.peerName +
        (session.remoteScreenSharing ? ' — sharing screen' : '');
    }

    // The pip keeps its dragged position; clear it when it becomes the big one.
    var pip = mediaLayer.querySelector('.is-pip');
    mediaLayer.querySelectorAll('[data-call-frame]').forEach(function (f) {
      if (f !== pip) { f.style.left = ''; f.style.top = ''; }
    });
    if (pip && session.localPos) {
      pip.style.left = session.localPos.x + 'px';
      pip.style.top = session.localPos.y + 'px';
    }
  }

  /*
   * Drag the small video inside the modal (§5). Snapping is deliberately
   * gentle: it only pulls to an edge when released within 32px of one, so a
   * deliberate placement in the middle of the frame is respected.
   */
  function wireLocalDrag() {
    var EDGE = 32, MARGIN = 12;
    var dragging = false, startX = 0, startY = 0, offX = 0, offY = 0, node = null;

    mediaLayer.addEventListener('pointerdown', function (e) {
      var frame = e.target.closest('.tma-call__frame.is-pip');
      if (!frame || e.target.closest('[data-call-action]')) return;
      if (!session || session.mode !== MODES.MODAL) return;
      node = frame;
      var rect = frame.getBoundingClientRect();
      var host = mediaLayer.getBoundingClientRect();
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      offX = e.clientX - rect.left; offY = e.clientY - rect.top;
      frame.classList.add('is-dragging');
      frame.style.left = (rect.left - host.left) + 'px';
      frame.style.top = (rect.top - host.top) + 'px';
      try { frame.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });

    mediaLayer.addEventListener('pointermove', function (e) {
      if (!dragging || !node) return;
      var host = mediaLayer.getBoundingClientRect();
      var w = node.offsetWidth, h = node.offsetHeight;
      var x = Math.max(MARGIN, Math.min(host.width - w - MARGIN, e.clientX - host.left - offX));
      var y = Math.max(MARGIN, Math.min(host.height - h - MARGIN, e.clientY - host.top - offY));
      node.style.left = x + 'px';
      node.style.top = y + 'px';
    });

    function endDrag(e) {
      if (!dragging || !node) return;
      dragging = false;
      node.classList.remove('is-dragging');
      try { node.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

      var tapped = Math.abs(e.clientX - startX) <= 4 && Math.abs(e.clientY - startY) <= 4;
      var host = mediaLayer.getBoundingClientRect();
      var w = node.offsetWidth, h = node.offsetHeight;
      var x = parseFloat(node.style.left) || 0;
      var y = parseFloat(node.style.top) || 0;

      if (x < EDGE) x = MARGIN;
      else if (host.width - (x + w) < EDGE) x = host.width - w - MARGIN;
      // Never let it settle over the controls along the bottom of the modal.
      var floor = host.height - h - 96;
      if (y > floor) y = floor;
      if (y < EDGE) y = MARGIN;

      node.style.left = x + 'px';
      node.style.top = y + 'px';
      if (session) session.localPos = { x: x, y: y };
      node = null;
      // A tap on the small video, rather than a drag, swaps the two (§6).
      if (tapped) swapVideos();
    }

    mediaLayer.addEventListener('pointerup', endDrag);
    mediaLayer.addEventListener('pointercancel', endDrag);
  }

  /* ------------------------------------------------------------------ *
   * The floating window (§24)
   *
   * A call should not hold the machine hostage. You take it, and then you get
   * on with your work — in the portal, in Excel, anywhere. Document
   * Picture-in-Picture gives us a real operating-system window for exactly
   * that: it floats above every other application, it is not a browser tab,
   * and it stays put while the user works somewhere else.
   *
   * The reason this is possible at all is the rule the rest of this file is
   * built on: there is one call, and the presentations are only ever renders of
   * it. The floating window is a *fifth place to draw the compact window*, not
   * a second call. The same persistent media layer is re-parented into it, so
   * the peer connection, the streams and the timer never learn that the window
   * changed; the same delegated [data-call-action] listener runs inside it, so
   * every control behaves identically to the one in the page.
   *
   * Where the browser has no such window (Safari, Firefox, an insecure origin,
   * or a gesture that has already expired) the compact window in the page is
   * the same thing without the operating system's help, and the call falls back
   * to it silently.
   * ------------------------------------------------------------------ */

  var floatWin = null;    // the WindowProxy, while it is open
  var floatRoot = null;   // the .tma-call element inside it

  /* Roomy enough for a face, small enough to leave open beside real work. */
  var FLOAT_SIZE = { video: { w: 380, h: 300 }, audio: { w: 320, h: 210 } };

  /*
   * Whether a call should float. Remembered on the machine rather than the
   * account, for the same reason a camera id is: it describes this screen and
   * this desk, not the person. Closing the window is itself an answer — the
   * call stops floating until it is popped out again.
   */
  var floatWanted = readStore('tma.call.float', '1') !== '0';

  function setFloatWanted(on) {
    floatWanted = !!on;
    writeStore('tma.call.float', on ? '1' : '0');
  }

  function floatSupported() {
    return !!(window.documentPictureInPicture &&
      typeof window.documentPictureInPicture.requestWindow === 'function');
  }

  function isFloating() { return !!(floatWin && !floatWin.closed && floatRoot); }

  /* Wherever the call is currently drawn. Everything that reaches into the
   * rendered call — the timer, the status line, focus — asks for this rather
   * than assuming the page. */
  function hostEl() { return isFloating() ? floatRoot : overlay; }

  /*
   * Must be called from a user gesture: no browser hands out a floating window
   * without one. Answering a call and placing a call are both clicks, which is
   * why the window is opened at those moments rather than when the call
   * finally connects — by then the gesture is long gone.
   */
  function openFloat() {
    if (!session || isFloating() || !floatWanted || !floatSupported()) {
      return Promise.resolve(false);
    }

    var size = FLOAT_SIZE[session.media === 'video' ? 'video' : 'audio'];

    return window.documentPictureInPicture
      .requestWindow({ width: size.w, height: size.h })
      .then(function (win) {
        if (!session) { try { win.close(); } catch (e) { /* ignore */ } return false; }
        floatWin = win;
        dressFloatWindow(win);
        // Closed from its own close button, or by the browser reclaiming it.
        win.addEventListener('pagehide', function () {
          if (floatWin !== win) return;   // we closed it ourselves; already handled
          floatWin = null;
          floatRoot = null;
          if (!session) return;
          // Closing the window is the user saying "not like that": keep the
          // call, put it back in the page, and stop floating until asked again.
          setFloatWanted(false);
          render();
          resumeMedia();
        });
        // The floating window *is* the small window; popping back in should
        // land there rather than in whatever was on screen before.
        session.mode = MODES.COMPACT;
        render();
        resumeMedia();
        return true;
      })
      .catch(function () {
        // No gesture left, or the browser said no. The page's own compact
        // window is the same call; nothing is lost by staying there.
        return false;
      });
  }

  function closeFloat(userAsked) {
    var win = floatWin;
    floatWin = null;
    floatRoot = null;
    if (userAsked) setFloatWanted(false);
    if (win && !win.closed) { try { win.close(); } catch (e) { /* ignore */ } }
  }

  /*
   * A picture-in-picture window opens empty — no stylesheet, no theme, not even
   * a background colour. Everything the call needs to look like itself has to
   * be carried across.
   */
  function dressFloatWindow(win) {
    var doc = win.document;
    doc.title = callKindLabel(session.media) + ' · ' + (session.peerName || '');

    /* The call's look lives in the app's own stylesheets. Copying the <link>s
     * means the window is styled by exactly the same rules — and, being links
     * to files the page has already fetched, they come from cache. */
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(function (node) {
      if (node.tagName === 'LINK') {
        var link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = node.href;    // the property is already absolute
        doc.head.appendChild(link);
        return;
      }
      var style = doc.createElement('style');
      style.textContent = node.textContent;
      doc.head.appendChild(style);
    });

    /* Last, and inline, so it is doing two jobs: it paints the window dark
     * immediately — before a single one of those stylesheets has arrived, which
     * is what stops the window opening as a white rectangle — and it still wins
     * afterwards over the app's light page background, which was never meant
     * to be behind a call. */
    var boot = doc.createElement('style');
    boot.textContent =
      'html,body{margin:0;height:100%;background:#05070c;overflow:hidden;' +
      '-webkit-font-smoothing:antialiased;}';
    doc.head.appendChild(boot);

    // Theme tokens hang off <html>; without them the window has no colours.
    var root = document.documentElement;
    doc.documentElement.className = root.className;
    if (root.getAttribute('data-theme')) {
      doc.documentElement.setAttribute('data-theme', root.getAttribute('data-theme'));
    }

    floatRoot = doc.createElement('div');
    floatRoot.className = 'tma-call tma-call--float';
    doc.body.appendChild(floatRoot);

    wireHost(floatRoot);
    // Escape has to mean the same thing in here as it does out there.
    doc.addEventListener('keydown', onKeyDown, true);
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   *
   * One shell per mode, reconciled on render; the media layer is re-parented
   * into it rather than recreated. Every control is a [data-call-action], so
   * a single delegated listener covers all four modes — which is what stops a
   * control existing in one layout and doing nothing in another.
   * ------------------------------------------------------------------ */

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'tma-call';
    document.body.appendChild(overlay);
    wireOverlay();
    return overlay;
  }

  function render() {
    if (!session) return;
    ensureOverlay();
    buildMediaLayer();
    buildAudioSink();

    var floating = isFloating();
    // A floating call is drawn in its own window, and the page is left with an
    // empty overlay — the portal underneath stays completely usable, which is
    // the whole point of putting the call in a window of its own.
    var mode = floating ? MODES.COMPACT : session.mode;
    var host = floating ? floatRoot : overlay;

    if (floating) {
      // Nothing of the call is left behind in the page — not an empty scrim,
      // not a stale class that still catches clicks.
      if (overlay.firstChild) overlay.textContent = '';
      overlay.className = 'tma-call tma-call--parked';
    }

    // hasAnyVideo, not session.media: a screen share in a voice call needs
    // the video layout (big frame, floating controls) without being one.
    host.className = 'tma-call tma-call--' + mode +
      (floating ? ' tma-call--float' : '') +
      ' tma-call--' + (hasAnyVideo() ? 'video' : 'audio') +
      (session.connected ? ' is-connected' : '') +
      (session.error ? ' has-error' : '');

    // Reconciling keeps focus on a surviving control, but a control that is
    // genuinely replaced still drops focus to <body> and sends the next Tab
    // back to the top of the page. Remember which one had it.
    var active = host.ownerDocument.activeElement;
    var focusedAction = active && host.contains(active) &&
      active.getAttribute('data-call-action');

    var html =
      '<div class="tma-call__live" data-call-live data-key="live" role="status" aria-live="assertive"></div>';

    if (mode === MODES.INCOMING) html += renderIncoming();
    else if (mode === MODES.MODAL) html += renderModal();
    else if (mode === MODES.COMPACT) html += renderCompact();
    else html += renderIsland();

    morph().patch(host, html);

    if (focusedAction && host.ownerDocument.activeElement !== active) {
      var again = host.querySelector('[data-call-action="' + focusedAction + '"]');
      if (again) again.focus();
    }

    // The slot is morph-skipped, so it keeps whatever it is already holding.
    // Appending only on a genuine move is what stops a live video element
    // being pulled out of the document and put back on every render.
    var slot = host.querySelector('[data-call-media-slot]');
    if (slot && mediaLayer.parentNode !== slot) {
      slot.appendChild(mediaLayer);
      resumeMedia();
    }

    syncMediaLayer();
    attachStreams();
    applyCompactPos();
    applyPillPos();
    revealControls(host);

    if (!floating && (mode === MODES.MODAL || mode === MODES.INCOMING)) captureFocus();
    else releaseFocus();

    publishCallPhase();
    tickDuration();
  }

  /*
   * Hidden controls have to introduce themselves once. The small window shows
   * its bars for a moment when it first appears and then gets out of the way,
   * so nobody has to guess that hovering does anything. Only on arrival — a
   * later render must not make them flash back, which is the exact behaviour
   * this whole change is here to remove.
   */
  var revealTimer = null;

  function revealControls(host) {
    var box = host && host.querySelector('.tma-call__compact');
    if (!box || box.__tmaRevealed) return;
    box.__tmaRevealed = true;
    box.classList.add('is-revealed');
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(function () {
      if (box.isConnected) box.classList.remove('is-revealed');
    }, 2200);
  }

  function avatarBlock(cls, size) {
    if (session && session.peerAvatar) {
      return '<span class="' + cls + '"' + (size ? ' style="width:' + size + 'px;height:' + size + 'px"' : '') +
        '><img src="' + esc(session.peerAvatar) + '" alt="" referrerpolicy="no-referrer"></span>';
    }
    return '<span class="' + cls + ' ' + cls + '--initials"' +
      (size ? ' style="width:' + size + 'px;height:' + size + 'px"' : '') + '>' +
      esc(initials(session && session.peerName)) + '</span>';
  }

  /*
   * ── Incoming: a plain, centered call card (§1,§14) ──
   * Deliberately quiet before it is answered — photo, who is calling, and the
   * two choices that matter. Mid-call controls (mute, camera, devices) belong
   * to the call once it exists, not to the decision of whether to take it, so
   * they are not shown here. A video call still previews the self-view so the
   * callee can see how they look before answering.
   */
  function renderIncoming() {
    var isVideo = session.media === 'video';
    var permission = session.previewError;
    var showPreview = isVideo && !permission;

    return '<div class="tma-call__scrim" data-key="scrim"></div>' +
      '<div class="tma-call__dialog tma-call__dialog--incoming' +
      (showPreview ? ' tma-call__dialog--incoming-video' : '') + '" data-key="incoming" ' +
      'role="dialog" aria-modal="true" ' +
      'aria-label="Incoming ' + (isVideo ? 'video' : 'voice') + ' call from ' + esc(session.peerName) + '">' +

      '<div class="tma-call__incoming-hero">' +
      (showPreview
        ? '<div class="tma-call__media-slot" data-call-media-slot data-morph-skip></div>'
        : avatarBlock('tma-call__incoming-photo') +
          '<div class="tma-call__media-park" data-call-media-slot data-morph-skip aria-hidden="true"></div>') +
      '</div>' +

      '<div class="tma-call__incoming-id">' +
      '<div class="tma-call__incoming-name">' + esc(session.peerName) + '</div>' +
      '<div class="tma-call__incoming-kind">' +
      '<span class="tma-call__pulse" aria-hidden="true"></span>' +
      'Incoming ' + (isVideo ? 'video call' : 'voice call') + '</div>' +
      (permission
        ? '<p class="tma-call__notice"><strong>' + esc(permission.title) + '</strong>' +
          '<span>' + esc(permission.message) + '</span></p>'
        : '') +
      '</div>' +

      '<div class="tma-call__incoming-actions">' +
      '<button type="button" class="tma-call__btn tma-call__btn--decline" data-call-action="decline">' +
      iconHangup() + '<span>Decline</span></button>' +
      (isVideo
        ? '<button type="button" class="tma-call__btn tma-call__btn--audio" data-call-action="accept-audio">' +
          iconPhone() + '<span>Voice only</span></button>'
        : '') +
      '<button type="button" class="tma-call__btn tma-call__btn--accept" data-call-action="accept">' +
      (isVideo ? iconVideo() : iconPhone()) + '<span>Answer</span></button>' +
      '</div>' +

      renderErrorPanel() +
      '</div>';
  }

  /* ── Large modal: most of the screen, not all of it (§3) ── */
  function renderModal() {
    var isVideo = session.media === 'video';
    var showsVideo = hasAnyVideo();
    return '<div class="tma-call__scrim" data-key="scrim" data-call-action="minimize"></div>' +
      '<div class="tma-call__dialog tma-call__dialog--stage" data-key="modal" ' +
      'role="dialog" aria-modal="true" ' +
      'aria-label="' + esc(callKindLabel(session.media)) + ' with ' + esc(session.peerName) + '">' +

      '<div class="tma-call__stage-head">' +
      '<div class="tma-call__stage-who">' +
      '<span class="tma-call__stage-name">' + esc(session.peerName) + '</span>' +
      '<span class="tma-call__stage-sub">' +
      '<span data-call-status>' + esc(session.statusText || '') + '</span>' +
      '<span class="tma-call__duration" data-call-duration></span>' +
      recordingChip() +
      qualityBadge() +
      '</span></div>' +
      '<div class="tma-call__stage-head-actions">' +
      '<button type="button" class="tma-call__icon-btn" data-call-action="mode-compact" ' +
      'aria-label="Move call to the compact window">' + iconCompact() + '</button>' +
      '<button type="button" class="tma-call__icon-btn" data-call-action="mode-island" ' +
      'aria-label="Move call to Dynamic Island">' + iconIsland() + '</button>' +
      '<button type="button" class="tma-call__icon-btn" data-call-action="minimize" ' +
      'aria-label="Minimize call">' + iconMinimize() + '</button>' +
      '</div></div>' +

      '<div class="tma-call__stage-body">' +
      '<div class="tma-call__media-slot" data-call-media-slot data-morph-skip></div>' +
      (showsVideo ? '' : '<div class="tma-call__audio-face">' + avatarBlock('tma-call__avatar-big') +
        '<div class="tma-call__audio-name">' + esc(session.peerName) + '</div></div>') +
      renderUpgradePrompt() +
      renderRecordingNotice() +
      '</div>' +

      '<div class="tma-call__controls">' +
      ctrl('mute', session.muted ? iconMicOff() : iconMic(), session.muted,
        session.muted ? 'Unmute microphone' : 'Mute microphone') +
      ctrl('camera', session.cameraOff || !isVideo ? iconCameraOff() : iconVideo(),
        isVideo && session.cameraOff,
        isVideo ? (session.cameraOff ? 'Turn camera on' : 'Turn camera off') : 'Switch to video') +
      (isVideo
        ? ctrl('switch-voice', iconPhone(), false, 'Switch to voice only')
        : '') +
      shareScreenBtn() +
      (supportsSinkId() ? ctrl('devices', iconSpeaker(), false, 'Audio and device settings') : '') +
      ctrl('swap', iconSwap(), false, 'Swap the large and small video', !showsVideo) +
      // Not `is-off`: on every other control that white, inverted state means
      // "this is switched off", and "More" is never off — it is open.
      '<button type="button" class="tma-call__ctrl' + (session.sheet ? ' is-active' : '') +
      '" data-call-action="more" aria-haspopup="menu" aria-expanded="' +
      (session.sheet ? 'true' : 'false') + '" aria-label="More options" title="More options">' +
      iconMore() + '</button>' +
      '<button type="button" class="tma-call__ctrl tma-call__ctrl--end" data-call-action="hangup" ' +
      'aria-label="End call">' + iconHangup() + '</button>' +
      '</div>' +

      renderMoreSheet() +
      renderDeviceSheet() +
      renderErrorPanel() +
      '</div>';
  }

  function ctrl(action, icon, off, label, hidden) {
    if (hidden) return '';
    return '<button type="button" class="tma-call__ctrl' + (off ? ' is-off' : '') +
      '" data-call-action="' + action + '" aria-pressed="' + (off ? 'true' : 'false') +
      '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + icon + '</button>';
  }

  /* Not ctrl(): sharing is `is-active` (a thing you are doing), never
   * `is-off` — that inverted state reads as "switched off" everywhere else. */
  function shareScreenBtn(small) {
    var label = session.screenSharing ? 'Stop sharing your screen' : 'Share your screen';
    return '<button type="button" class="tma-call__ctrl' +
      (small ? ' tma-call__ctrl--sm' : '') +
      (session.screenSharing ? ' is-active' : '') +
      '" data-call-action="share-screen" aria-pressed="' + (session.screenSharing ? 'true' : 'false') +
      '" aria-label="' + label + '" title="' + label + '">' + iconScreen() + '</button>';
  }

  /* The red dot beside the clock — recording is never only a colour, the
   * word rides with it (§ the quality badge follows the same rule). */
  function recordingChip() {
    if (!session.recording && !session.remoteRecording) return '';
    return '<span class="tma-call__rec" title="This call is being recorded">' +
      '<span class="tma-call__rec-dot" aria-hidden="true"></span>REC</span>';
  }

  /*
   * The consent line. Shown to BOTH sides the moment recording is arranged —
   * the recorder starts on a delay behind it (§ maybeStartRecording), so
   * nobody is captured before they have been told. Dismissing hides the
   * sentence once it has been read; the REC chip stays for the whole call.
   */
  function renderRecordingNotice() {
    if (!session.recording && !session.remoteRecording) return '';
    if (session.recordingNoticeDismissed) return '';
    return '<div class="tma-call__prompt tma-call__prompt--recording" role="status">' +
      '<span class="tma-call__rec-dot" aria-hidden="true"></span>' +
      '<span>This call is being recorded for client service and record-keeping purposes.</span>' +
      '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="dismiss-recording">OK</button>' +
      '</div>';
  }

  function qualityBadge() {
    if (!session.quality || !session.connected) return '';
    var label = { good: 'Good connection', fair: 'Fair connection', poor: 'Weak connection' }[session.quality];
    return '<span class="tma-call__quality tma-call__quality--' + session.quality + '" title="' + esc(label) + '">' +
      iconSignal() + '<span class="tma-call__quality-label">' + esc(label) + '</span></span>';
  }

  /*
   * ── The small window (§7, §8, §19) ──
   *
   * The picture *is* the window. It runs edge to edge, and everything else —
   * who you are talking to, how long for, and every control — floats over it
   * and stays out of the way until the pointer arrives. That is how a call
   * window behaves everywhere else on the machine, and it is what makes this
   * small enough to leave open beside real work.
   *
   * Two bars, on purpose. The top one is about the *window*: where it sits,
   * how big it is, whether it floats. The bottom one is about the *call*:
   * microphone, camera, screen, hang up. Both appear together on hover, and on
   * focus, so a keyboard reaches everything the pointer can.
   *
   * The same markup draws the window in the page and in the floating window;
   * only the document it lands in differs.
   */
  function renderCompact() {
    var isVideo = session.media === 'video';
    var showsVideo = hasAnyVideo();
    var floating = isFloating();

    var windowBtns = floating
      // Floating: the operating system owns where this window sits and how big
      // it is, so the only thing left to offer is the way back into the page.
      ? '<button type="button" class="tma-call__compact-btn" data-call-action="pop-in" ' +
        'aria-label="Put the call back in the page" title="Put the call back in the page">' +
        iconPopIn() + '</button>'
      : (floatSupported()
          ? '<button type="button" class="tma-call__compact-btn" data-call-action="pop-out" ' +
            'aria-label="Float the call above other apps" title="Float the call above other apps">' +
            iconPopOut() + '</button>'
          : '') +
        '<button type="button" class="tma-call__compact-btn" data-call-action="mode-modal" ' +
        'aria-label="Open the large call window" title="Open the large call window">' +
        iconExpand() + '</button>' +
        '<button type="button" class="tma-call__compact-btn" data-call-action="mode-island" ' +
        'aria-label="Switch to Dynamic Island" title="Switch to Dynamic Island">' +
        iconIsland() + '</button>' +
        '<button type="button" class="tma-call__compact-btn" data-call-action="restore" ' +
        'aria-label="Return to the previous call view" title="Return to the previous call view">' +
        iconBack() + '</button>' +
        '<span class="tma-call__compact-grip" data-call-drag aria-hidden="true">' + iconMove() + '</span>';

    return '<div class="tma-call__compact" data-key="compact" role="dialog" aria-label="' +
      esc(callKindLabel(session.media)) + ' with ' + esc(session.peerName) + '">' +

      '<div class="tma-call__compact-stage">' +
      (showsVideo
        ? '<div class="tma-call__media-slot" data-call-media-slot data-morph-skip></div>'
        // A voice call has no picture, but the media layer still has to live
        // somewhere — it is the one thing that is moved rather than rebuilt.
        : '<div class="tma-call__compact-face">' + avatarBlock('tma-call__compact-avatar') +
          '<div class="tma-call__media-park" data-call-media-slot data-morph-skip aria-hidden="true"></div></div>') +
      '</div>' +

      '<div class="tma-call__compact-top">' +
      '<div class="tma-call__compact-id">' +
      '<span class="tma-call__compact-name">' + esc(session.peerName) + '</span>' +
      '<span class="tma-call__compact-meta">' +
      recordingChip() +
      '<span class="tma-call__compact-kind">' + esc(callKindLabel(session.media)) + '</span>' +
      '<span class="tma-call__duration" data-call-duration></span>' +
      '</span></div>' +
      '<div class="tma-call__compact-window-btns">' + windowBtns + '</div>' +
      '</div>' +

      '<div class="tma-call__compact-controls">' +
      ctrl('mute', session.muted ? iconMicOff() : iconMic(), session.muted,
        session.muted ? 'Unmute microphone' : 'Mute microphone') +
      ctrl('camera', isVideo && !session.cameraOff ? iconVideo() : iconCameraOff(),
        isVideo && session.cameraOff,
        isVideo ? (session.cameraOff ? 'Turn camera on' : 'Turn camera off') : 'Switch to video') +
      shareScreenBtn(true) +
      '<button type="button" class="tma-call__ctrl tma-call__ctrl--sm tma-call__ctrl--end" ' +
      'data-call-action="hangup" aria-label="End call" title="End call">' + iconHangup() + '</button>' +
      '</div>' +

      renderUpgradePrompt() +
      renderRecordingNotice() +
      renderErrorPanel() +
      '</div>';
  }

  /* ── Dynamic Island (§9) — the original capsule, kept as it was ── */
  function renderIsland() {
    var isVideo = session.media === 'video';
    return '<div class="tma-call__pill tma-call__pill--' + pillPos + '" data-key="island" role="dialog" ' +
      'aria-label="' + esc(callKindLabel(session.media)) + ' with ' + esc(session.peerName) + '">' +
      '<button type="button" class="tma-call__pill-body" data-call-action="mode-modal" ' +
      'aria-label="Open the large call window">' +
      avatarBlock('tma-call__pill-avatar') +
      '<span class="tma-call__pill-meta">' +
      '<span class="tma-call__pill-name">' + esc(session.peerName) + '</span>' +
      '<span class="tma-call__pill-status">' +
      recordingChip() +
      '<span data-call-status>' + esc(session.statusText || '') + '</span>' +
      '<span class="tma-call__duration" data-call-duration></span>' +
      '</span></span></button>' +
      '<button type="button" class="tma-call__pill-move" data-call-drag aria-label="Move call" ' +
      'title="Move call">' + iconMove() + '</button>' +
      '<button type="button" class="tma-call__pill-btn' + (session.muted ? ' is-off' : '') +
      '" data-call-action="mute" aria-pressed="' + (session.muted ? 'true' : 'false') +
      '" aria-label="' + (session.muted ? 'Unmute microphone' : 'Mute microphone') + '">' +
      (session.muted ? iconMicOff() : iconMic()) + '</button>' +
      // Always visible, including on a voice call, so switching to video is
      // one deliberate click and never a hidden-until-hover discovery (§12).
      '<button type="button" class="tma-call__pill-btn' + (isVideo && session.cameraOff ? ' is-off' : '') +
      '" data-call-action="camera" aria-label="' +
      (isVideo ? (session.cameraOff ? 'Turn camera on' : 'Turn camera off') : 'Switch to video') + '">' +
      (isVideo && !session.cameraOff ? iconVideo() : iconCameraOff()) + '</button>' +
      '<button type="button" class="tma-call__pill-btn tma-call__pill-btn--reveal" data-call-action="mode-compact" ' +
      'aria-label="Move call to the compact window">' + iconCompact() + '</button>' +
      '<button type="button" class="tma-call__pill-end" data-call-action="hangup" ' +
      'aria-label="End call">' + iconHangup() + '</button>' +
      '</div>' +
      // The media layer still needs a home while the island is showing: it is
      // moved between presentations, never rebuilt, so it always has one.
      '<div class="tma-call__media-park" data-call-media-slot data-morph-skip aria-hidden="true"></div>' +
      renderUpgradePrompt() +
      renderRecordingNotice() +
      renderErrorPanel();
  }

  /* ── Panels shared by the modes ── */

  function renderErrorPanel() {
    if (!session.error) return '';
    var e = session.error;
    var actions = '';
    if (e.media) {
      if (e.kind !== 'unsupported') {
        actions += '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="retry-media">Try again</button>';
        actions += '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="devices">Device settings</button>';
      }
      // Only offered when audio is actually a way forward: a failed camera
      // leaves a usable voice call, a failed microphone does not.
      if (e.wantVideo) {
        actions += '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="continue-audio">Continue with audio</button>';
      }
      // A connected call is still a call. Let the user acknowledge the missing
      // device and carry on rather than trapping them behind the panel.
      if (session.connected) {
        actions += '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="dismiss-error">Continue anyway</button>';
      }
    } else if (e.kind === 'connection') {
      actions += '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="retry-connection">Retry</button>';
    } else {
      // Everything that is not the connection itself — a declined upgrade, a
      // failed screen share — leaves a perfectly good call running. There
      // must always be a way past the panel that is not hanging up.
      actions += '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="dismiss-error">Continue</button>';
    }
    actions += '<button type="button" class="tma-call__btn tma-call__btn--decline" data-call-action="hangup">End call</button>';

    return '<div class="tma-call__error" role="alert">' +
      '<div class="tma-call__error-title">' + esc(e.title) + '</div>' +
      '<div class="tma-call__error-msg">' + esc(e.message) + '</div>' +
      '<div class="tma-call__error-actions">' + actions + '</div>' +
      '</div>';
  }

  function renderUpgradePrompt() {
    if (!session.upgrade) return '';
    if (session.upgrade.direction === 'confirm') {
      return '<div class="tma-call__prompt" role="dialog" aria-label="Turn on video">' +
        '<span>This is your camera. Turn video on for this call?</span>' +
        '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="upgrade-cancel">Cancel</button>' +
        '<button type="button" class="tma-call__btn tma-call__btn--accept" data-call-action="upgrade-confirm">Start video</button>' +
        '</div>';
    }
    if (session.upgrade.direction === 'out') {
      return '<div class="tma-call__prompt" role="status">' +
        '<span>Waiting for ' + esc(session.peerName) + ' to accept video…</span>' +
        '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="upgrade-cancel">Cancel</button>' +
        '</div>';
    }
    return '<div class="tma-call__prompt" role="alertdialog" aria-label="Video request">' +
      '<span>' + esc(session.peerName) + ' wants to turn this into a video call.</span>' +
      '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="upgrade-decline">No thanks</button>' +
      '<button type="button" class="tma-call__btn tma-call__btn--accept" data-call-action="upgrade-accept">Turn on video</button>' +
      '</div>';
  }

  function renderMoreSheet() {
    if (session.sheet !== 'more') return '';
    return '<div class="tma-call__sheet" role="menu" aria-label="More options">' +
      '<button type="button" class="tma-call__sheet-item" role="menuitem" data-call-action="devices">' +
      iconSettings() + '<span>Device settings</span></button>' +
      '<button type="button" class="tma-call__sheet-item" role="menuitem" data-call-action="mode-compact">' +
      iconCompact() + '<span>Compact window</span></button>' +
      '<button type="button" class="tma-call__sheet-item" role="menuitem" data-call-action="mode-island">' +
      iconIsland() + '<span>Dynamic Island</span></button>' +
      (session.media === 'video'
        ? '<button type="button" class="tma-call__sheet-item" role="menuitem" data-call-action="switch-voice">' +
          iconPhone() + '<span>Switch to voice only</span></button>'
        : '<button type="button" class="tma-call__sheet-item" role="menuitem" data-call-action="camera">' +
          iconVideo() + '<span>Switch to video</span></button>') +
      '</div>';
  }

  function renderDeviceSheet() {
    if (session.sheet !== 'devices') return '';
    var list = session.deviceList;
    if (!list) return '<div class="tma-call__sheet tma-call__sheet--devices"><p class="tma-call__sheet-note">Loading devices…</p></div>';

    function group(kind, label, options) {
      if (!options.length) {
        return '<label class="tma-call__field"><span>' + esc(label) + '</span>' +
          '<select disabled><option>None available</option></select></label>';
      }
      var current = session.devices[kind] || '';
      return '<label class="tma-call__field"><span>' + esc(label) + '</span>' +
        '<select data-call-device="' + kind + '">' +
        options.map(function (o) {
          return '<option value="' + esc(o.id) + '"' + (o.id === current ? ' selected' : '') + '>' +
            esc(o.label) + '</option>';
        }).join('') + '</select></label>';
    }

    return '<div class="tma-call__sheet tma-call__sheet--devices" role="dialog" aria-label="Device settings">' +
      '<div class="tma-call__sheet-head"><span>Devices</span>' +
      '<button type="button" class="tma-call__icon-btn" data-call-action="close-sheet" aria-label="Close device settings">' +
      iconClose() + '</button></div>' +
      group('camera', 'Camera', list.camera) +
      group('microphone', 'Microphone', list.microphone) +
      (supportsSinkId()
        ? group('speaker', 'Speaker', list.speaker)
        : '<p class="tma-call__sheet-note">This browser does not let a page choose the speaker.</p>') +
      '<div class="tma-call__sheet-actions">' +
      '<button type="button" class="tma-call__btn tma-call__btn--ghost" data-call-action="test-audio">' +
      iconSpeaker() + '<span>Test speaker</span></button>' +
      // Live input level: the only honest way to answer "is my microphone
      // working?", and it costs nothing while the sheet is closed.
      '<span class="tma-call__meter" data-call-meter title="Microphone level"><i></i></span>' +
      '</div>' +
      '<p class="tma-call__sheet-note">Speak to check your microphone. Your choices are remembered on this device.</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ *
   * Icons
   *
   * The artwork is Phosphor, from `public/images/icons/phosphor/`, named in
   * dashboard.css and inlined by `scripts/inline_icon_masks.py`. Nothing here
   * is drawn by hand: DESIGN_SYSTEM.md § Assets → Icons forbids new inline
   * paths in JS while a file for the glyph exists, and one exists for all of
   * these.
   *
   * A masked <span>, not an <img>. These SVGs are black, and an <img> of one
   * cannot be recoloured by CSS — the same trap the sidebar nav hit. A call is
   * drawn on near-black, so every glyph has to take its colour from the control
   * around it, which is what `background-color: currentColor` behind a mask
   * does. The name is the only thing this file decides; the art and the size
   * both live in CSS.
   * ------------------------------------------------------------------ */

  function ico(name) {
    return '<span class="tma-call__ico tma-call__ico--' + name + '" aria-hidden="true"></span>';
  }

  function iconPhone()      { return ico('phone'); }            /* Phone */
  function iconVideo()      { return ico('video'); }            /* VideoCamera */
  function iconCameraOff()  { return ico('video-off'); }        /* VideoCameraSlash */
  function iconHangup()     { return ico('hangup'); }           /* PhoneDisconnect */
  function iconMic()        { return ico('mic'); }              /* Microphone */
  function iconMicOff()     { return ico('mic-off'); }          /* MicrophoneSlash */
  function iconMinimize()   { return ico('minimize'); }         /* Minus */
  function iconExpand()     { return ico('expand'); }           /* ArrowsOut */
  function iconCompact()    { return ico('compact'); }          /* PictureInPicture */
  function iconIsland()     { return ico('island'); }           /* Rectangle */
  function iconSwap()       { return ico('swap'); }             /* Swap */
  function iconMore()       { return ico('more'); }             /* DotsThree */
  function iconSpeaker()    { return ico('speaker'); }          /* SpeakerHigh */
  function iconSettings()   { return ico('settings'); }         /* GearSix */
  function iconClose()      { return ico('close'); }            /* X */
  function iconBack()       { return ico('back'); }             /* ArrowLeft */
  function iconSignal()     { return ico('signal'); }           /* CellSignalHigh */
  function iconMove()       { return ico('move'); }             /* ArrowsOutCardinal */
  function iconScreen()     { return ico('screen'); }           /* Monitor */
  /* Out of the page into a window of its own, and back into the page. */
  function iconPopOut()     { return ico('pop-out'); }          /* ArrowSquareOut */
  function iconPopIn()      { return ico('pop-in'); }           /* ArrowSquareIn */

  /* ------------------------------------------------------------------ *
   * Modes
   * ------------------------------------------------------------------ */

  function setMode(mode, options) {
    if (!session || session.mode === mode) return;
    options = options || {};
    // Remember where we came from so minimizing can return there (§10). The
    // answer pop-up is never a restore target — nobody wants to go "back" to
    // an incoming call that has already been answered.
    if (!options.silent && session.mode !== MODES.INCOMING && session.mode !== MODES.MODAL) {
      session.prevMode = session.mode;
    }
    session.sheet = null;
    session.mode = mode;
    // The compact window always reopens in the far bottom-right — forget any
    // spot it was dragged to the last time it was shown.
    if (mode === MODES.COMPACT) session.compactPos = null;
    render();
  }

  /*
   * Minimize returns the call to whatever it was before it was expanded (§10)
   * — the island if it came from the island, the compact window if it came
   * from there. It falls back to the user's preference, and never to a
   * hardcoded layout.
   */
  function minimize() {
    if (!session) return;
    var target = session.prevMode || defaultMode();
    if (target === MODES.MODAL || target === MODES.INCOMING) target = defaultMode();
    if (target === MODES.MODAL) target = MODES.ISLAND;
    // Already there (e.g. "restore" pressed in the compact window with no
    // earlier mode to go back to): step down to the smallest presentation.
    if (target === session.mode) target = MODES.ISLAND;
    setMode(target, { silent: true });
  }

  function applyPillPos() {
    if (!overlay) return;
    var pill = overlay.querySelector('.tma-call__pill');
    if (!pill) return;
    PILL_POSITIONS.forEach(function (p) { pill.classList.remove('tma-call__pill--' + p); });
    pill.classList.add('tma-call__pill--' + pillPos);
  }

  function cyclePillPos() {
    var i = PILL_POSITIONS.indexOf(pillPos);
    pillPos = PILL_POSITIONS[(i + 1) % PILL_POSITIONS.length];
    writeStore('tma.call.pillPos', pillPos);
    applyPillPos();
  }

  /*
   * The compact window's resting place (§19): the far bottom-right corner. It
   * lands there every time the mode is entered — setMode() clears any position
   * it was dragged to on a previous visit — and a drag within the session is
   * still honoured until the next entry, clamped back into view on resize.
   */
  function defaultCompactPos(w, h) {
    return {
      x: Math.max(16, window.innerWidth - w - 16),
      y: Math.max(16, window.innerHeight - h - 16),
    };
  }

  function applyCompactPos() {
    // A floating window is placed by the operating system, not by us.
    if (isFloating()) return;
    if (!overlay || !session || session.mode !== MODES.COMPACT) return;
    var box = overlay.querySelector('.tma-call__compact');
    if (!box) return;
    if (window.matchMedia('(max-width: 640px)').matches) {
      box.style.left = ''; box.style.top = '';
      return;
    }
    var w = box.offsetWidth, h = box.offsetHeight;
    var pos = session.compactPos || defaultCompactPos(w, h);
    pos = {
      x: Math.max(8, Math.min(window.innerWidth - w - 8, pos.x)),
      y: Math.max(8, Math.min(window.innerHeight - h - 8, pos.y)),
    };
    session.compactPos = pos;
    box.style.left = pos.x + 'px';
    box.style.top = pos.y + 'px';
  }

  /* ------------------------------------------------------------------ *
   * Controls — one delegated listener for every mode (§17)
   * ------------------------------------------------------------------ */

  var ACTIONS = {
    accept: function () { acceptIncoming(true); },
    'accept-audio': function () { acceptIncoming(false); },
    decline: function () { declineIncoming(); },
    hangup: function () { endSession(true); },

    mute: function () { toggleMute(); },
    camera: function () { toggleCamera(); },
    'switch-voice': function () { switchToVoice(); },
    swap: function () { swapVideos(); },
    'share-screen': function () { toggleScreenShare(); },
    'dismiss-recording': function () { session.recordingNoticeDismissed = true; render(); },

    minimize: function () { minimize(); },
    restore: function () { minimize(); },
    'mode-modal': function () { setMode(MODES.MODAL); },
    'mode-compact': function () { setMode(MODES.COMPACT); },
    'mode-island': function () { setMode(MODES.ISLAND); },

    // Out of the page and into a window of its own; and back again. Both run
    // from a click, which is the only moment a floating window can be asked for.
    'pop-out': function () { setFloatWanted(true); openFloat(); },
    'pop-in': function () {
      closeFloat(true);
      setMode(MODES.COMPACT, { silent: true });
      render();
      resumeMedia();
    },

    more: function () {
      session.sheet = session.sheet === 'more' ? null : 'more';
      stopMeter();
      render();
    },
    devices: function () {
      session.sheet = 'devices';
      render();
      if (!session.deviceList) loadDeviceList().then(startMeter);
      else startMeter();
    },
    'close-sheet': function () { session.sheet = null; stopMeter(); render(); },
    'test-audio': function () { testAudio(); },

    'retry-media': function () { retryMedia(); },
    'continue-audio': function () { continueWithAudio(); },
    'retry-connection': function () { retryConnection(); },
    'dismiss-error': function () { clearError(); },

    'upgrade-confirm': function () { confirmUpgrade(); },
    'upgrade-accept': function () { acceptUpgrade(); },
    'upgrade-decline': function () { declineUpgrade(); },
    'upgrade-cancel': function () { cancelUpgrade(); },
  };

  /*
   * One delegated listener per place the call can be drawn. Bound to the root
   * rather than to the controls, so it survives every render — and applied to
   * the floating window's root too, which is what makes a button in that
   * window do exactly what the same button does in the page.
   */
  function wireHost(root) {
    if (!root || root.__tmaCallWired) return;
    root.__tmaCallWired = true;

    root.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-call-action]');
      if (!btn || !root.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      var fn = ACTIONS[btn.getAttribute('data-call-action')];
      if (fn && session) fn(btn);
    });

    root.addEventListener('change', function (e) {
      var sel = e.target.closest('[data-call-device]');
      if (!sel) return;
      switchDevice(sel.getAttribute('data-call-device'), sel.value);
    });
  }

  function wireOverlay() {
    if (wired || !overlay) return;
    wired = true;
    wireHost(overlay);
    wireDragHandles();
  }

  /*
   * Escape minimizes; it never ends the call (§21). Ending is a deliberate,
   * irreversible act and must not share a key with "get this out of my way".
   */
  function onKeyDown(e) {
    if (!session) return;
    if (e.key === 'Escape') {
      if (session.sheet) { session.sheet = null; stopMeter(); render(); e.preventDefault(); return; }
      // Escape in the floating window would have to mean "close the window",
      // which the operating system already offers and which is not what the
      // key means anywhere else in the call.
      if (!isFloating() && session.mode === MODES.MODAL) { minimize(); e.preventDefault(); }
      return;
    }
    if (e.key === 'Tab' && !isFloating() && overlay &&
        (session.mode === MODES.MODAL || session.mode === MODES.INCOMING)) {
      trapTab(e);
    }
  }
  document.addEventListener('keydown', onKeyDown, true);

  window.addEventListener('resize', function () {
    if (!session) return;
    applyCompactPos();
    if (session.localPos && mediaLayer) {
      // Keep the dragged pip inside the frame when the window changes size.
      var pip = mediaLayer.querySelector('.is-pip');
      if (pip) {
        var host = mediaLayer.getBoundingClientRect();
        session.localPos = {
          x: Math.max(12, Math.min(host.width - pip.offsetWidth - 12, session.localPos.x)),
          y: Math.max(12, Math.min(host.height - pip.offsetHeight - 12, session.localPos.y)),
        };
        syncMediaLayer();
      }
    }
  });

  /* Focus stays inside an open call dialog and returns where it came from. */
  var lastFocus = null;

  function focusables() {
    var root = hostEl();
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll(
      'button:not([disabled]), select:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return el.offsetParent !== null; });
  }

  function captureFocus() {
    var root = hostEl();
    if (!root) return;
    if (!lastFocus) lastFocus = document.activeElement;
    var items = focusables();
    if (items.length && !root.contains(root.ownerDocument.activeElement)) items[0].focus();
  }

  function releaseFocus() {
    if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
      lastFocus.focus();
    }
    lastFocus = null;
  }

  function trapTab(e) {
    var items = focusables();
    if (!items.length) return;
    var here = items[0].ownerDocument.activeElement;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && here === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && here === last) { first.focus(); e.preventDefault(); }
  }

  /*
   * Dragging, for the island's handle and the compact window's grip. Both live
   * on elements that are rebuilt on every render, so the listener is on the
   * overlay and the handle is found per gesture.
   */
  function wireDragHandles() {
    var dragging = null;

    overlay.addEventListener('pointerdown', function (e) {
      var handle = e.target.closest('[data-call-drag]');
      if (!handle) return;
      var box = handle.closest('.tma-call__pill, .tma-call__compact');
      if (!box) return;
      e.preventDefault();
      var rect = box.getBoundingClientRect();
      dragging = {
        box: box,
        kind: box.classList.contains('tma-call__compact') ? 'compact' : 'pill',
        offX: e.clientX - rect.left,
        offY: e.clientY - rect.top,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      if (dragging.kind === 'pill') {
        PILL_POSITIONS.forEach(function (p) { box.classList.remove('tma-call__pill--' + p); });
        box.style.right = 'auto';
        box.style.bottom = 'auto';
        box.style.transform = 'none';
      }
      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      box.classList.add('is-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });

    overlay.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      if (Math.abs(e.clientX - dragging.startX) > 3 || Math.abs(e.clientY - dragging.startY) > 3) {
        dragging.moved = true;
      }
      var box = dragging.box;
      var w = box.offsetWidth, h = box.offsetHeight;
      box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, e.clientX - dragging.offX)) + 'px';
      box.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, e.clientY - dragging.offY)) + 'px';
    });

    function endDrag() {
      if (!dragging) return;
      var d = dragging;
      dragging = null;
      d.box.classList.remove('is-dragging');

      if (d.kind === 'compact') {
        if (session) session.compactPos = { x: parseFloat(d.box.style.left) || 0, y: parseFloat(d.box.style.top) || 0 };
        applyCompactPos();
        return;
      }

      if (!d.moved) {
        d.box.style.left = ''; d.box.style.top = '';
        d.box.style.right = ''; d.box.style.bottom = ''; d.box.style.transform = '';
        cyclePillPos();
        return;
      }
      // Snap the island to the nearest of its six anchors.
      var rect = d.box.getBoundingClientRect();
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      var horiz = cx < window.innerWidth / 3 ? 'l' : (cx > window.innerWidth * 2 / 3 ? 'r' : 'c');
      pillPos = (cy < window.innerHeight / 2 ? 't' : 'b') + horiz;
      writeStore('tma.call.pillPos', pillPos);
      d.box.style.left = ''; d.box.style.top = '';
      d.box.style.right = ''; d.box.style.bottom = ''; d.box.style.transform = '';
      applyPillPos();
    }

    overlay.addEventListener('pointerup', endDrag);
    overlay.addEventListener('pointercancel', endDrag);
  }

  /* ------------------------------------------------------------------ *
   * In-call state changes
   * ------------------------------------------------------------------ */

  function toggleMute() {
    if (!session) return;
    session.muted = !session.muted;
    var stream = session.localStream || session.previewStream;
    if (stream) stream.getAudioTracks().forEach(function (t) { t.enabled = !session.muted; });
    render();
    announce(session.muted ? 'Microphone muted' : 'Microphone on');
    if (session.connected) publishState();
  }

  /*
   * The camera button means two different things, and which one is never in
   * doubt: in a video call it turns your own camera off and on; in a voice
   * call it starts the deliberate switch to video (§12) — which asks the other
   * person first and never just starts sending.
   */
  function toggleCamera() {
    if (!session) return;

    if (session.media !== 'video') { requestUpgrade(); return; }

    session.cameraOff = !session.cameraOff;
    var stream = session.localStream || session.previewStream;
    if (stream) stream.getVideoTracks().forEach(function (t) { t.enabled = !session.cameraOff; });
    render();
    announce(session.cameraOff ? 'Camera off' : 'Camera on');
    if (session.connected) publishState();
  }

  function swapVideos() {
    if (!session || !hasAnyVideo()) return;
    session.swapped = !session.swapped;
    // The dragged position belongs to the corner, not to whichever frame is
    // currently in it, so it carries over to the new small video.
    syncMediaLayer();
    announce(session.swapped ? 'Your video is now the large one' : session.peerName + ' is now the large video');
  }

  /* ── Screen sharing ──
   *
   * A pure replaceTrack() on the video sender that has existed since the call
   * was negotiated — the same trick voice↔video switching uses, so sharing
   * never renegotiates either. session.media is left alone: the camera flow
   * keeps its meaning, and the far end learns about the share through the
   * `state` signal instead.
   */

  function toggleScreenShare() {
    if (!session) return;
    if (session.screenSharing) stopScreenShare();
    else startScreenShare();
  }

  function startScreenShare() {
    if (!session || session.screenSharing) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showError({
        title: 'Screen sharing unavailable',
        message: 'This browser cannot share a screen.',
        kind: 'unsupported',
      });
      return;
    }
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      if (!session) { stopStream(stream); return; }
      var track = stream.getVideoTracks()[0];
      if (!track) { stopStream(stream); return; }
      session.screenStream = stream;
      session.screenSharing = true;
      // The browser's own "Stop sharing" pill ends the track without telling
      // us first — treat that exactly like our Stop button.
      track.onended = function () { stopScreenShare(); };
      if (session.videoSender) session.videoSender.replaceTrack(track).catch(function () {});
      // The self-view now shows the screen, so it must re-attach.
      resetLocalPreviewElement();
      render();
      announce('You are sharing your screen');
      if (session.connected) publishState();
    }).catch(function (err) {
      // Cancelling the picker is a decision, not an error — Chromium reports
      // it as NotAllowedError and it stays silent. Anything else means
      // sharing is genuinely unavailable (an outdated desktop shell, OS
      // screen-recording permission, policy), and swallowing that made the
      // button read as simply dead.
      if (err && err.name === 'NotAllowedError') return;
      if (!session) return;
      showError({
        title: 'Screen sharing unavailable',
        message: 'The screen could not be shared from here. If this is the desktop app, update it and check it has screen-recording permission.',
        kind: 'unsupported',
      });
    });
  }

  function stopScreenShare() {
    if (!session || !session.screenSharing) return;
    stopStream(session.screenStream);
    session.screenStream = null;
    session.screenSharing = false;
    // Back to whatever the camera flow was doing: the live camera track on a
    // video call, nothing on a voice call.
    var camera = session.media === 'video' && session.localStream
      ? session.localStream.getVideoTracks()[0] || null
      : null;
    if (session.videoSender) session.videoSender.replaceTrack(camera).catch(function () {});
    resetLocalPreviewElement();
    render();
    announce('Screen sharing stopped');
    if (session.connected) publishState();
  }

  /* attachStreams() only swaps srcObject when the stream changed; clearing it
   * first is what makes it notice the share starting or ending. */
  function resetLocalPreviewElement() {
    if (!mediaLayer) return;
    var local = mediaLayer.querySelector('[data-call-local]');
    if (local) local.srcObject = null;
    attachStreams();
  }

  /* ── Client-call recording ──
   *
   * Calls between a staff member and a client are recorded for the client's
   * file (§ CallRecordingController). The server is the single authority on
   * WHETHER a call is such a call: both sides ask at connect, and only the
   * staff side of a staff↔client call is handed a recording id — so this
   * code never needs to know who is a client, and nobody can talk a browser
   * into recording a colleague.
   *
   * Consent before capture: the banner renders and the `state` signal goes
   * out the moment the id arrives, and the recorder starts on a delay behind
   * them, so no frame exists that predates the notice. Never record silently.
   *
   * What is captured: both voices, mixed into one track — a recording with
   * one side of a conversation is not a record of it — plus the client's
   * video when the call has one. Chunks upload every few seconds while the
   * call runs, so a crash mid-call costs seconds, not the recording.
   */

  var REC_CHUNK_MS = 10000;
  var REC_NOTICE_LEAD_MS = 1500;

  function maybeStartRecording(attempt) {
    if (!session || session.recording) return;
    if (typeof MediaRecorder === 'undefined') return;
    if (!api() || !api().callRecordingStart) return;

    var conversationId = session.conversationId;
    api().callRecordingStart(conversationId, { media: session.media }).then(function (data) {
      var rec = data && data.recording;
      if (!rec || !rec.id) return;
      if (!session || session.conversationId !== conversationId || session.recording) {
        // The call ended (or was replaced) while the request was in flight.
        // The server already opened a row for it — close it, or it lingers
        // in the listing as a phantom "interrupted" recording forever.
        api().callRecordingFinish(rec.id, { failed: true }).catch(function () {});
        return;
      }

      session.recording = {
        id: rec.id,
        seq: 0,
        queue: Promise.resolve(),
        recorder: null,
        ctx: null,
        dest: null,
        localSource: null,
        mime: '',
        hasVideo: false,
        startedAt: null,
        stopped: false,
      };
      session.recordingNoticeDismissed = false;
      render();
      announce('This call is being recorded');
      publishState();

      // The notice leads, the recorder follows.
      setTimeout(function () {
        if (session && session.recording && session.recording.id === rec.id &&
          !session.recording.stopped) beginRecorder();
      }, REC_NOTICE_LEAD_MS);
    }).catch(function (err) {
      // A 4xx answer means "not a recorded call" and silence is the whole
      // answer. A network blip or 5xx means an ELIGIBLE call would silently
      // go unrecorded — that gets one more try before giving up.
      var transient = !err || err.status === undefined || err.status >= 500;
      if (transient && !attempt) {
        setTimeout(function () {
          if (session && session.conversationId === conversationId &&
            session.connected && !session.recording) maybeStartRecording(1);
        }, 4000);
      }
    });
  }

  function pickRecorderMime(candidates) {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function beginRecorder() {
    var rec = session && session.recording;
    if (!rec || rec.recorder) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var tracks = [];
      var ctx = null;

      if (Ctx) {
        ctx = new Ctx();
        var dest = ctx.createMediaStreamDestination();
        // The local source is kept on the bundle: a mid-call microphone
        // switch stops this exact track, and the recorder has to be handed
        // the replacement or it captures silence from our side on.
        var localTrack = session.localStream && session.localStream.getAudioTracks()[0];
        if (localTrack) {
          rec.localSource = ctx.createMediaStreamSource(new MediaStream([localTrack]));
          rec.localSource.connect(dest);
        }
        var remoteTrack = session.remoteStream && session.remoteStream.getAudioTracks()[0];
        if (remoteTrack) {
          ctx.createMediaStreamSource(new MediaStream([remoteTrack])).connect(dest);
        }
        rec.dest = dest;
        tracks = dest.stream.getAudioTracks();
      } else {
        // No AudioContext: the client's voice alone beats nothing at all.
        var fallback = (session.remoteStream && session.remoteStream.getAudioTracks()[0]) ||
          (session.localStream && session.localStream.getAudioTracks()[0]);
        if (fallback) tracks = [fallback];
      }

      // The client's picture, when the call has one. A MediaRecorder keeps
      // the track list it was born with, so a voice call that upgrades later
      // stays an audio recording — the metadata says which it was.
      var video = session.media === 'video' && session.remoteStream
        ? session.remoteStream.getVideoTracks()[0] || null
        : null;
      if (video) tracks = tracks.concat([video]);
      if (!tracks.length) { abandonRecording(); return; }

      var mime = video
        ? pickRecorderMime(['video/webm;codecs=vp8,opus', 'video/webm'])
        : pickRecorderMime(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']);

      var recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime || undefined,
        audioBitsPerSecond: 48000,
        // Modest on purpose: this is a record of a conversation, not a film,
        // and an hour at this rate stays comfortably uploadable.
        videoBitsPerSecond: video ? 650000 : undefined,
      });

      rec.ctx = ctx;
      rec.recorder = recorder;
      rec.mime = mime || (video ? 'video/webm' : 'audio/webm');
      rec.hasVideo = !!video;
      rec.startedAt = Date.now();

      recorder.ondataavailable = function (ev) {
        if (!ev.data || !ev.data.size) return;
        pushRecordingChunk(rec, ev.data);
      };
      recorder.onerror = function () {
        stopRecording();
        // Mid-call failure, not teardown: the call goes on, so both sides
        // must stop being told they are recorded when they no longer are.
        if (session) {
          render();
          publishState();
          announce('Recording stopped');
        }
      };
      recorder.start(REC_CHUNK_MS);
    } catch (e) {
      abandonRecording();
      if (window.console) console.warn('[call] recording unavailable —', e && e.message);
    }
  }

  /*
   * Chunks ride a promise chain, one at a time, so they land on the server in
   * order — the file is a single WebM stream and order IS the file. One retry
   * per chunk; the server treats a repeated seq as already-written, so a
   * retry whose first attempt actually landed cannot double-append.
   */
  function pushRecordingChunk(rec, blob) {
    var seq = rec.seq++;
    rec.queue = rec.queue.then(function () {
      return api().callRecordingChunk(rec.id, blob, seq).catch(function () {
        return api().callRecordingChunk(rec.id, blob, seq);
      });
    }).catch(function () {
      // A lost chunk is a gap in the recording; a rejected chain would lose
      // everything after it, which is worse.
    });
  }

  /* A mid-call microphone swap hands the recorder the replacement track —
   * the old source's track was stopped, which reads as silence forever. */
  function rewireRecorderLocalAudio(track) {
    var rec = session && session.recording;
    if (!rec || !rec.ctx || !rec.dest || !track) return;
    try {
      if (rec.localSource) rec.localSource.disconnect();
      rec.localSource = rec.ctx.createMediaStreamSource(new MediaStream([track]));
      rec.localSource.connect(rec.dest);
    } catch (e) { /* the call outranks the recording */ }
  }

  /* Callable mid-teardown: detaches the bundle from the session first, so the
   * final chunk and the finish call outlive the call that made them. */
  function stopRecording() {
    var rec = session && session.recording;
    if (!rec) return;
    session.recording = null;
    finishRecording(rec);
  }

  function finishRecording(rec) {
    if (rec.stopped) return;
    rec.stopped = true;
    var durationMs = rec.startedAt ? Date.now() - rec.startedAt : 0;

    var flushed = new Promise(function (resolve) {
      if (!rec.recorder || rec.recorder.state === 'inactive') { resolve(); return; }
      rec.recorder.onstop = resolve;
      try { rec.recorder.stop(); } catch (e) { resolve(); }
    });

    flushed.then(function () {
      if (rec.ctx) { try { rec.ctx.close().catch(function () {}); } catch (e) { /* ignore */ } }
      // stop() fires its final dataavailable before onstop, so the last chunk
      // is already on the queue; finish rides in behind it.
      rec.queue = rec.queue.then(function () {
        return api().callRecordingFinish(rec.id, {
          durationMs: durationMs,
          media: rec.hasVideo ? 'video' : 'audio',
          mime: rec.mime,
        });
      }).catch(function () {
        // The row stays 'recording'; the listing shows it as interrupted.
      });
    });
  }

  /* The recorder never produced anything — tell the server so the row does
   * not linger as a phantom "recording in progress". */
  function abandonRecording() {
    var rec = session && session.recording;
    if (!rec) return;
    session.recording = null;
    rec.stopped = true;
    api().callRecordingFinish(rec.id, { durationMs: 0, failed: true }).catch(function () {});
    render();
    if (session.connected) publishState();
  }

  /* ── Voice ⇄ video (§12, §13) ── */

  /*
   * Voice → video, in the order a person expects (§12): see yourself first,
   * decide, and only then ask the other side. Nothing is sent — not the
   * request, and certainly not the picture — until the user confirms.
   */
  function requestUpgrade() {
    if (!session || session.upgrade) return;
    getMedia(true).then(function (stream) {
      if (!session) { stopStream(stream); return; }
      var video = stream.getVideoTracks()[0];
      // The call already has a microphone; this grab was only for the camera.
      stream.getAudioTracks().forEach(function (t) {
        stream.removeTrack(t);
        try { t.stop(); } catch (e) { /* ignore */ }
      });
      if (!video) {
        showError(describeMediaError({ name: 'NotFoundError' }, true));
        return;
      }
      session.pendingVideoTrack = video;
      session.upgradePreview = stream;
      session.upgrade = { direction: 'confirm' };
      if (session.mode === MODES.ISLAND || session.mode === MODES.COMPACT) setMode(MODES.MODAL);
      else render();
      attachStreams();
    }).catch(function (err) {
      showError(describeMediaError(err, true));
    });
  }

  function confirmUpgrade() {
    if (!session || !session.upgrade || session.upgrade.direction !== 'confirm') return;
    session.upgrade = { direction: 'out' };
    render();
    signal('upgrade', { media: 'video' });
  }

  function acceptUpgrade() {
    if (!session) return;
    getMedia(true).then(function (stream) {
      if (!session) { stopStream(stream); return; }
      var video = stream.getVideoTracks()[0];
      var audio = stream.getAudioTracks()[0];
      if (audio) { try { audio.stop(); } catch (e) { /* ignore */ } }
      session.upgrade = null;
      adoptVideoTrack(video);
      signal('upgrade-accept', { media: 'video' });
      applyVideoMode(true);
    }).catch(function (err) {
      session.upgrade = null;
      signal('upgrade-decline', { media: 'video' });
      showError(describeMediaError(err, true));
    });
  }

  function declineUpgrade() {
    if (!session) return;
    session.upgrade = null;
    signal('upgrade-decline', { media: 'video' });
    render();
  }

  function cancelUpgrade() {
    if (!session) return;
    var asked = session.upgrade && session.upgrade.direction === 'out';
    session.upgrade = null;
    dropPendingVideo();
    // Only retract a request that was actually made — cancelling the private
    // confirm step never tells the other side anything happened.
    if (asked) signal('upgrade-decline', { media: 'video' });
    render();
  }

  function dropPendingVideo() {
    if (!session) return;
    if (session.pendingVideoTrack) {
      try { session.pendingVideoTrack.stop(); } catch (e) { /* ignore */ }
      session.pendingVideoTrack = null;
    }
    if (session.upgradePreview) {
      stopStream(session.upgradePreview);
      session.upgradePreview = null;
    }
  }

  /* Put a fresh camera track onto the already-negotiated video sender. */
  function adoptVideoTrack(track) {
    if (!session || !track) return;
    session.upgradePreview = null;
    if (!session.localStream) session.localStream = new MediaStream();
    session.localStream.getVideoTracks().forEach(function (t) {
      session.localStream.removeTrack(t);
      try { t.stop(); } catch (e) { /* ignore */ }
    });
    session.localStream.addTrack(track);
    track.enabled = true;
    // While a screen is being shared the sender belongs to the share; the
    // camera waits in localStream and takes the wire back when it stops.
    if (session.videoSender && !session.screenSharing) {
      session.videoSender.replaceTrack(track).catch(function () {});
    }
    attachStreams();
  }

  function applyVideoMode(on) {
    if (!session) return;
    session.media = on ? 'video' : 'audio';
    session.cameraOff = false;
    render();
    publishState();
    announce(on ? 'Video on' : 'Video off — voice call continues');
  }

  function switchToVoice() {
    if (!session || session.media !== 'video') return;
    // Stop sending pictures, keep the audio call exactly as it is (§13).
    // A live screen share owns the sender and stays — only the camera stops.
    if (session.videoSender && !session.screenSharing) {
      session.videoSender.replaceTrack(null).catch(function () {});
    }
    if (session.localStream) {
      session.localStream.getVideoTracks().forEach(function (t) {
        session.localStream.removeTrack(t);
        try { t.stop(); } catch (e) { /* ignore */ }
      });
    }
    session.swapped = false;
    signal('downgrade', { media: 'audio' });
    applyVideoMode(false);
  }

  /* ── Error recovery (§23) ── */

  function retryMedia() {
    if (!session) return;
    clearError();
    var wantVideo = session.media === 'video';

    // The outgoing call never got as far as ringing — start it over rather
    // than collecting a stream that nothing is waiting for.
    if (session.role === 'caller' && !session.pc) { render(); beginOutgoing(); return; }

    getMedia(wantVideo).then(function (stream) {
      if (!session) { stopStream(stream); return; }
      if (session.mode === MODES.INCOMING) {
        session.previewStream = stream;
        session.previewError = null;
        attachStreams();
        render();
        return;
      }
      var audio = stream.getAudioTracks()[0];
      var video = stream.getVideoTracks()[0];
      if (!session.localStream) session.localStream = new MediaStream();
      if (audio) {
        session.localStream.getAudioTracks().forEach(function (t) { session.localStream.removeTrack(t); });
        session.localStream.addTrack(audio);
        if (session.audioSender) session.audioSender.replaceTrack(audio).catch(function () {});
      }
      if (video) adoptVideoTrack(video);
      attachStreams();
      render();
    }).catch(function (err) {
      showError(describeMediaError(err, wantVideo));
    });
  }

  function retryConnection() {
    if (!session || !session.pc) return;
    clearError();
    setStatus('Reconnecting…');
    if (typeof session.pc.restartIce === 'function') {
      session.pc.restartIce();
      return;
    }
    // Older browsers: a fresh offer with iceRestart is the same request.
    session.pc.createOffer({ iceRestart: true }).then(function (offer) {
      return session.pc.setLocalDescription(offer).then(function () {
        signal('offer', { payload: { sdp: offer } });
      });
    }).catch(function () {
      showError({ title: 'Could not reconnect', message: 'The call could not be restored.', kind: 'connection' });
    });
  }

  /*
   * Live microphone level while the device sheet is open (§16).
   *
   * Torn down the moment the sheet closes: an AudioContext and an animation
   * frame loop running for the whole call to drive a bar nobody is looking at
   * is a battery cost with no reader.
   */
  var meter = null;

  function startMeter() {
    stopMeter();
    if (!session || !overlay) return;
    if (!overlay.querySelector('[data-call-meter] i')) return;
    var stream = session.localStream || session.previewStream;
    var track = stream && stream.getAudioTracks()[0];
    if (!track) return;

    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var source = ctx.createMediaStreamSource(new MediaStream([track]));
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      var data = new Uint8Array(analyser.frequencyBinCount);
      var raf = null;

      function tick() {
        // Looked up per frame rather than captured: any re-render replaces the
        // sheet, and a captured node would leave the bar frozen at whatever it
        // last showed.
        var bar = overlay && overlay.querySelector('[data-call-meter] i');
        if (!bar) { stopMeter(); return; }

        analyser.getByteTimeDomainData(data);
        var peak = 0;
        for (var i = 0; i < data.length; i++) {
          var v = Math.abs(data[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        // A muted microphone reads as silence, which is the truth.
        bar.style.width = Math.min(100, Math.round(peak * 180)) + '%';
        raf = requestAnimationFrame(tick);
      }
      tick();
      meter = { ctx: ctx, stop: function () { if (raf) cancelAnimationFrame(raf); } };
    } catch (e) {
      // No meter is better than a broken sheet, but a silent failure here is
      // indistinguishable from a dead microphone — say so in the console.
      if (window.console) console.warn('[call] microphone meter unavailable —', e && e.message);
    }
  }

  function stopMeter() {
    if (!meter) return;
    meter.stop();
    meter.ctx.close().catch(function () {});
    meter = null;
  }

  /* A short tone through the selected output, so "test" means something. */
  function testAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      setTimeout(function () { ctx.close().catch(function () {}); }, 900);
    } catch (e) { /* a failed test tone is not a call failure */ }
  }

  /* ------------------------------------------------------------------ *
   * Placing, answering, declining
   * ------------------------------------------------------------------ */

  /*
   * The outgoing sequence: get local media, build the peer connection, ring,
   * offer. Separate from startCall() because "continue with audio" after a
   * camera failure has to run exactly this again with different media, and a
   * half-started call is the one thing worse than a failed one.
   */
  function beginOutgoing() {
    var wantVideo = session.media === 'video';
    return getMedia(wantVideo)
      .then(function (stream) {
        if (!session) { stopStream(stream); return; }
        session.localStream = stream;
        if (session.muted) stream.getAudioTracks().forEach(function (t) { t.enabled = false; });
        clearError();
        attachStreams();
        ensurePeer();
        render();
        return signal('ring', { media: session.media });
      })
      .then(function () {
        if (!session || !session.pc) return;
        return session.pc.createOffer().then(function (offer) {
          return session.pc.setLocalDescription(offer).then(function () {
            return signal('offer', { media: session.media, payload: { sdp: offer } });
          });
        });
      })
      .catch(function (err) {
        showError(describeMediaError(err, wantVideo));
      });
  }

  /*
   * A camera that will not start should not cost you the call (§23). Before it
   * is connected this re-runs the outgoing sequence as a voice call; once
   * connected it is the ordinary video→voice switch.
   */
  function continueWithAudio() {
    if (!session) return;
    clearError();
    if (session.connected) { switchToVoice(); return; }
    session.media = 'audio';
    session.cameraOff = false;
    if (session.role === 'callee') {
      // Answering with video failed — answer as a voice call instead.
      acceptIncoming(false);
      return;
    }
    render();
    beginOutgoing();
  }

  function startCall(conversationId, media, peerName, peerAvatar, viewerId) {
    if (viewerId != null) meId = viewerId;
    if (session) endSession(true);
    media = media === 'video' ? 'video' : 'audio';

    session = newSession({
      conversationId: conversationId,
      media: media,
      role: 'caller',
      initiatorId: meId,
      peerName: peerName || 'Contact',
      peerAvatar: peerAvatar || null,
      // A call you placed shows its full window while it rings — you are
      // looking at it, and it is the only place the ringing state is legible.
      // markConnected() hands it to the user's preferred display once
      // answered, and minimizing goes there too.
      mode: MODES.MODAL,
      prevMode: defaultMode(),
      statusText: 'Calling…',
    });
    render();
    // Straight into its own window, from the click that placed the call — the
    // only moment a floating window can be asked for. It rings, connects and
    // runs in there, and the portal behind it is never taken over.
    openFloat();
    // The caller hears the same tone back while it rings, which is the only
    // signal that the call is actually going somewhere. It is started from the
    // click, so autoplay policy never blocks this side.
    startRinging();
    beginOutgoing();
    armRingTimeout();
  }

  /*
   * The pre-answer preview (§2). Local only: these tracks are never given to
   * the peer connection, so nothing reaches the caller until the call is
   * answered — and because the same tracks are then handed to the call,
   * answering does not prompt for the camera a second time.
   */
  function startPreview(wantVideo) {
    if (!session) return Promise.resolve();
    session.previewWantsVideo = wantVideo;
    stopStream(session.previewStream);
    session.previewStream = null;
    session.previewError = null;

    return getMedia(wantVideo).then(function (stream) {
      if (!session || session.mode !== MODES.INCOMING) { stopStream(stream); return; }
      session.previewStream = stream;
      stream.getAudioTracks().forEach(function (t) { t.enabled = !session.muted; });
      stream.getVideoTracks().forEach(function (t) { t.enabled = !session.cameraOff; });
      attachStreams();
      render();
    }).catch(function (err) {
      if (!session) return;
      // A denied camera must not blank the pop-up: fall back to the caller's
      // picture with a plain explanation, and keep Answer available (§2).
      session.previewError = describeMediaError(err, wantVideo);
      if (wantVideo) {
        session.cameraOff = true;
        // Audio alone may still be available — a call with no picture is fine.
        getMedia(false).then(function (audioOnly) {
          if (!session || session.mode !== MODES.INCOMING) { stopStream(audioOnly); return; }
          session.previewStream = audioOnly;
          audioOnly.getAudioTracks().forEach(function (t) { t.enabled = !session.muted; });
          render();
        }).catch(function () { render(); });
      } else {
        render();
      }
    });
  }

  function acceptIncoming(withVideo) {
    if (!session || session.role !== 'callee') return;

    stopRinging();
    clearRingTimeout();

    var wantVideo = session.media === 'video' && withVideo !== false;
    session.media = wantVideo ? 'video' : 'audio';
    session.accepting = true;
    session.statusText = 'Connecting…';
    // The self-view was the main picture while deciding; once answered the
    // other person takes the main frame.
    session.swapped = false;
    // Answering lands in the user's preferred display (§15).
    session.mode = defaultMode();
    session.prevMode = session.mode;
    render();
    // Answering is a click — in the page, or the desktop app's ring panel,
    // which forwards it as a real gesture. That click is the whole budget for
    // opening a floating window, so it is spent here rather than on connect.
    openFloat();

    // Reuse the preview's tracks — no second permission prompt (§22).
    var ready = session.previewStream
      ? Promise.resolve(session.previewStream)
      : getMedia(wantVideo).catch(function (err) {
        // Never drop the call over local media: join receive-only so the
        // caller can still be heard, and say so.
        session.error = describeMediaError(err, wantVideo);
        return null;
      });

    ready.then(function (stream) {
      if (!session) { stopStream(stream); return; }
      if (!session.error && (!stream || !stream.getAudioTracks().length)) {
        // Joining without a microphone is still better than not joining, but
        // the person has to be told they cannot be heard — otherwise they talk
        // into a call that is silently one-way.
        session.error = {
          title: 'No microphone',
          message: 'You joined without a microphone, so the other person cannot hear you.',
          kind: 'missing', media: true, wantVideo: false,
        };
      }
      if (stream) {
        session.localStream = stream;
        session.previewStream = null;
        stream.getAudioTracks().forEach(function (t) { t.enabled = !session.muted; });
        if (!wantVideo) {
          stream.getVideoTracks().forEach(function (t) {
            stream.removeTrack(t);
            try { t.stop(); } catch (e) { /* ignore */ }
          });
        } else {
          stream.getVideoTracks().forEach(function (t) { t.enabled = !session.cameraOff; });
        }
      }
      ensurePeer();
      attachStreams();
      render();
      signal('accept', { media: session.media });
      return maybeAnswer();
    }).catch(function (err) {
      showError({
        title: 'Could not join the call',
        message: (err && err.message) || 'The connection could not be set up.',
        kind: 'connection',
      });
    });
  }

  function declineIncoming() {
    if (!session) return;
    stopRinging();
    stopMeter();
    signal('reject', {
      media: session.media,
      initiatorId: session.initiatorId || meId || null,
      answered: false,
    });
    stopTimer();
    teardownMedia();
    session = null;
    closeOverlay();
  }

  /*
   * Create and send the SDP answer, but only once both the local media and the
   * caller's offer are available. Callable more than once — it no-ops until
   * the preconditions are met and after it has already answered.
   */
  function maybeAnswer() {
    if (!session || session.role !== 'callee' || session.answered) return;
    // Local media is intentionally not required: a receive-only answer is
    // valid and lets someone join with no working mic or camera.
    if (!session.accepting || !session.remoteOffer || !session.pc) return;

    var offer = toDescription(session.remoteOffer, 'offer');
    if (!offer) {
      showError({ title: 'Could not connect', message: 'The call setup message was unreadable.', kind: 'connection' });
      return;
    }

    session.answered = true;
    return session.pc.setRemoteDescription(offer)
      .then(function () {
        adoptSenders();
        flushCandidates();
        return session.pc.createAnswer();
      })
      .then(function (answer) {
        return session.pc.setLocalDescription(answer).then(function () {
          return signal('answer', { media: session.media, payload: { sdp: answer } });
        });
      })
      .catch(function (err) {
        if (session) session.answered = false;
        showError({
          title: 'Could not connect',
          message: (err && err.message) || 'The call could not be answered.',
          kind: 'connection',
        });
      });
  }

  /* ------------------------------------------------------------------ *
   * Signalling in
   * ------------------------------------------------------------------ */

  function onSignal(payload, viewerId) {
    if (viewerId != null) meId = viewerId;
    if (!payload || payload.fromUserId === meId) return;

    // The same signal arrives on the conversation channel and on this user's
    // own channel — apply it once (see App\Events\CallSignal).
    if (payload.signalId) {
      if (!seenSignals[payload.signalId]) seenSignals[payload.signalId] = Date.now();
      else return;
      pruneSeen();
    }

    var type = payload.type;
    var convId = payload.conversationId;
    var body = payload.payload || {};
    var media = body.media || 'audio';
    var fromName = payload._peerName || body.fromName || 'Contact';
    var fromPhoto = payload._peerPhoto || body.fromPhoto || null;

    if (type === 'ring' || type === 'offer') {
      if (session && session.conversationId !== convId) return;
      if (!session) {
        session = newSession({
          conversationId: convId,
          media: media,
          role: 'callee',
          initiatorId: payload.fromUserId || null,
          peerName: fromName,
          peerAvatar: fromPhoto,
          mode: MODES.INCOMING,
          statusText: 'Ringing…',
          remoteOffer: body.sdp || null,
          // Before answering, the big picture is *you* — the point of the
          // preview is seeing how you look. The caller has not sent anything
          // yet, and will not until this is answered.
          swapped: media === 'video',
        });
        render();
        startRinging();
        showCallNotification(session);
        announce('Incoming ' + (media === 'video' ? 'video' : 'voice') + ' call from ' + fromName);
        // Show the callee their own camera before they answer (§2).
        startPreview(media === 'video');
        loadDeviceList();
        armRingTimeout();
        // Tell the caller the phone is actually ringing here — until this
        // lands their side only knows it asked ("Calling…").
        signal('state', { payload: { ringing: true } });
      } else if (type === 'offer' && body.sdp) {
        session.remoteOffer = body.sdp;
        if (!session.peerAvatar && fromPhoto) session.peerAvatar = fromPhoto;
        maybeAnswer();
      }
      return;
    }

    if (!session || session.conversationId !== convId) return;

    if (type === 'accept') {
      // Answered. The media connection takes a moment more, but ringing past
      // the moment somebody picked up is the wrong sound — and an answered
      // call must never be cut down by the no-answer clock.
      stopRinging();
      clearRingTimeout();
      if (session.role === 'caller') setStatus('Connecting…');
      return;
    }

    if (type === 'answer' && session.pc && body.sdp) {
      var answer = toDescription(body.sdp, 'answer');
      if (!answer) return;
      session.pc.setRemoteDescription(answer)
        .then(function () {
          flushCandidates();
          if (!session.connected) setStatus('Connecting…');
        })
        .catch(function () { /* a late/duplicate answer is not fatal */ });
      return;
    }

    if (type === 'ice' && body.candidate) {
      if (!session.candidates) session.candidates = [];
      session.candidates.push(body.candidate);
      if (session.pc) flushCandidates();
      return;
    }

    // The far end's microphone/camera state — what turns a black rectangle
    // into their photo (§4). Screen share and recording ride the same signal:
    // both are things a peer cannot see for themselves and must be told.
    if (type === 'state') {
      // The callee's ring acknowledgement: "Calling…" becomes "Ringing…" the
      // moment their device actually rings. A pure ack carries no device
      // state, so it must not clobber the mute/camera defaults.
      if (body.ringing) {
        if (session.role === 'caller' && !session.connected) {
          setStatus('Ringing…');
          announce('Ringing');
        }
        return;
      }
      session.remoteMuted = !!body.muted;
      session.remoteCameraOff = !!body.cameraOff;
      if (body.screenSharing !== undefined) {
        var startedSharing = !!body.screenSharing && !session.remoteScreenSharing;
        session.remoteScreenSharing = !!body.screenSharing;
        if (startedSharing) announce(session.peerName + ' is sharing their screen');
      }
      if (body.recording !== undefined) {
        var startedRecording = !!body.recording && !session.remoteRecording;
        session.remoteRecording = !!body.recording;
        if (startedRecording) announce('This call is being recorded');
      }
      if (body.media && body.media !== session.media && body.media === 'audio') {
        session.media = 'audio';
      }
      render();
      return;
    }

    if (type === 'upgrade') {
      if (session.upgrade && session.upgrade.direction === 'out') {
        // Both asked at once — the one who did not place the call yields.
        if (session.role === 'caller') return;
        session.upgrade = null;
      }
      session.upgrade = { direction: 'in' };
      render();
      announce(session.peerName + ' wants to switch to video');
      return;
    }

    if (type === 'upgrade-accept') {
      var track = session.pendingVideoTrack;
      session.pendingVideoTrack = null;
      session.upgrade = null;
      if (track) adoptVideoTrack(track);
      applyVideoMode(true);
      return;
    }

    if (type === 'upgrade-decline') {
      dropPendingVideo();
      session.upgrade = null;
      showError({
        title: 'Video declined',
        message: session.peerName + ' preferred to stay on voice.',
        kind: 'declined',
      });
      return;
    }

    if (type === 'downgrade') {
      session.remoteCameraOff = false;
      session.swapped = false;
      if (session.media === 'video') {
        // Same guard as switchToVoice: during a screen share the sender is
        // carrying the SCREEN, and the peer turning their camera off must
        // not rip our share off the wire.
        if (session.videoSender && !session.screenSharing) {
          session.videoSender.replaceTrack(null).catch(function () {});
        }
        if (session.localStream) {
          session.localStream.getVideoTracks().forEach(function (t) {
            session.localStream.removeTrack(t);
            try { t.stop(); } catch (e) { /* ignore */ }
          });
        }
      }
      applyVideoMode(false);
      return;
    }

    if (type === 'hangup' || type === 'reject') {
      var wasConnected = session.connected;
      stopMeter();
      // Before teardownMedia: pc.close() ends the remote tracks, and the
      // recorder's final chunk has to be cut before they die.
      stopRecording();
      stopTimer();
      teardownMedia();
      session = null;
      closeOverlay();
      if (!wasConnected && window.TMAToast && window.TMAToast.show) {
        window.TMAToast.show(type === 'reject' ? 'Call declined' : 'Call ended');
      }
    }
  }

  /* Signals seen recently, so a duplicate delivery is applied once. */
  var seenSignals = {};
  function pruneSeen() {
    var cutoff = Date.now() - 120000;
    Object.keys(seenSignals).forEach(function (k) {
      if (seenSignals[k] < cutoff) delete seenSignals[k];
    });
  }

  function bindConversation(realtime, conversationId, viewerId) {
    if (!realtime || !conversationId) return;
    realtime.listen('private-conversation.' + conversationId, 'call.signal', function (payload) {
      onSignal(payload, viewerId);
    });
  }

  // Ask for camera, microphone and notification permission once, on the first
  // interaction with the Messages page, so no real call has to stop and prompt.
  armPermissionPrimer();

  window.TMAMessagingCalls = {
    start: startCall,
    setViewer: function (id) { if (id != null) meId = id; },
    end: function () { endSession(true); },
    onSignal: onSignal,
    bindConversation: bindConversation,
    isActive: function () { return !!session; },
    /* Let the page request permissions eagerly too (e.g. from a call button). */
    prime: primeCallEnvironment,
    /*
     * Answering from outside the page: the desktop shell rings in its own
     * window, and its buttons have to land on the same code paths as the ones
     * in the overlay rather than synthesising clicks at them.
     */
    accept: function (withVideo) { acceptIncoming(withVideo !== false); },
    decline: function () { declineIncoming(); },
    /* Settings write-through: the preference is read on the next answered call. */
    setDisplayPreference: function (mode) {
      if (mode === MODES.MODAL || mode === MODES.COMPACT || mode === MODES.ISLAND) {
        writeStore('tma.call.display', mode);
        if (window.TMAMessagingSettings) window.TMAMessagingSettings.callDisplay = mode;
      }
    },
    /*
     * Whether a call floats in a window of its own. The setting is per machine
     * (a floating window is about this screen), so it is read and written here
     * rather than through MessagingSettings.
     */
    floatPreference: function (on) {
      if (on === undefined) return floatWanted;
      setFloatWanted(on);
      if (!on) closeFloat(false);
      else if (session) openFloat();
      return floatWanted;
    },
    floatSupported: floatSupported,
    /* Exposed for the browser tests, which drive the UI without a real peer. */
    _debug: function () {
      return {
        session: session,
        mode: session && session.mode,
        meter: !!meter,
        floating: isFloating(),
      };
    },
  };
})();
