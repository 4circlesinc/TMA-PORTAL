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
  var wired = false;       // delegated listeners are attached once, to `overlay`

  var MODES = { INCOMING: 'incoming', MODAL: 'modal', COMPACT: 'compact', ISLAND: 'island' };

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

      muted: false,
      cameraOff: false,
      // What the far end says about itself. Assumed on until told otherwise,
      // so a peer that never reports does not look permanently camera-off.
      remoteMuted: false,
      remoteCameraOff: false,

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
    if (el.getAttribute('data-tma-call') === phase) return;
    if (phase) el.setAttribute('data-tma-call', phase);
    else el.removeAttribute('data-tma-call');
  }

  function closeOverlay() {
    stopRinging();
    document.documentElement.removeAttribute('data-tma-call');
    releaseFocus();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    mediaLayer = null;
    wired = false;
  }

  function endSession(sendHangup) {
    stopMeter();
    if (!session) { closeOverlay(); return; }
    if (sendHangup) signal('hangup', {
      media: session.media,
      initiatorId: session.initiatorId || null,
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

  /* Tell the other end what our microphone and camera are doing (§4). */
  function publishState() {
    signal('state', {
      payload: {
        muted: !!session.muted,
        cameraOff: !!session.cameraOff,
        media: session.media,
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
    if (!session || !session.devices.speaker || !mediaLayer) return;
    var audio = mediaLayer.querySelector('[data-call-audio]');
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

      if (sender) sender.replaceTrack(track).catch(function () { /* ignore */ });
      if (session.localStream) {
        if (old) { session.localStream.removeTrack(old); try { old.stop(); } catch (e) { /* ignore */ } }
        session.localStream.addTrack(track);
      }
      if (!wantVideo) track.enabled = !session.muted;
      else track.enabled = !session.cameraOff;
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
    if (session.mode !== defaultMode()) setMode(defaultMode(), { silent: true });
    else render();

    publishState();
    announce(callKindLabel(session.media) + ' connected');
  }

  function tickDuration() {
    if (!session || !session.startedAt || !overlay) return;
    var text = formatDuration(Date.now() - session.startedAt);
    overlay.querySelectorAll('[data-call-duration]').forEach(function (n) { n.textContent = text; });
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
    if (!overlay) return;
    overlay.querySelectorAll('[data-call-status]').forEach(function (n) { n.textContent = text; });
  }

  /* One assertive region so a screen reader hears the call, not the layout. */
  function announce(text) {
    if (!overlay || !text) return;
    var live = overlay.querySelector('[data-call-live]');
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
      '</div>' +
      '<audio data-call-audio autoplay></audio>';
    mediaLayer = el;
    wireLocalDrag();
    return el;
  }

  function localPicture() {
    // Order matters: an in-progress video upgrade is showing the user the
    // camera they are about to share, which must win over the live call
    // stream that does not carry video yet.
    return session.upgradePreview || session.localStream || session.previewStream || null;
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
    var audio = mediaLayer.querySelector('[data-call-audio]');
    if (audio && session.remoteStream && audio.srcObject !== session.remoteStream) {
      audio.srcObject = session.remoteStream;
      audio.play().catch(function () {});
      applySpeaker();
    }
  }

  /*
   * Reflect state onto the media layer without rebuilding it — this runs on
   * every render, and rebuilding would restart the video elements.
   */
  function syncMediaLayer() {
    if (!mediaLayer || !session) return;

    var remoteHasVideo = session.media === 'video' && !session.remoteCameraOff &&
      !!(session.remoteStream && session.remoteStream.getVideoTracks().some(function (t) {
        return t.readyState === 'live';
      }));
    var picture = localPicture();
    var localHasVideo = !session.cameraOff && !!(picture && picture.getVideoTracks().length) &&
      (session.media === 'video' || !!session.upgradePreview);

    mediaLayer.classList.toggle('is-swapped', !!session.swapped);
    mediaLayer.classList.toggle('has-remote-video', remoteHasVideo);
    mediaLayer.classList.toggle('has-local-video', localHasVideo);

    var big = session.swapped ? 'local' : 'remote';
    mediaLayer.querySelectorAll('[data-call-frame]').forEach(function (f) {
      var isBig = f.getAttribute('data-call-frame') === big;
      f.classList.toggle('is-big', isBig);
      f.classList.toggle('is-pip', !isBig);
    });

    var avatar = mediaLayer.querySelector('[data-call-remote-avatar]');
    if (avatar) {
      avatar.innerHTML = session.peerAvatar
        ? '<img src="' + esc(session.peerAvatar) + '" alt="" referrerpolicy="no-referrer">'
        : esc(initials(session.peerName));
      avatar.classList.toggle('tma-call__off-avatar--initials', !session.peerAvatar);
    }
    var nameEl = mediaLayer.querySelector('[data-call-remote-name]');
    if (nameEl) nameEl.textContent = session.peerName;
    var tag = mediaLayer.querySelector('[data-call-remote-tag]');
    if (tag) tag.textContent = session.peerName;

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
   * Rendering
   *
   * One shell per mode, rebuilt on render; the media layer is re-parented
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

    var mode = session.mode;
    overlay.className = 'tma-call tma-call--' + mode +
      ' tma-call--' + (session.media === 'video' ? 'video' : 'audio') +
      (session.connected ? ' is-connected' : '') +
      (session.error ? ' has-error' : '');

    // A render replaces every control, which would drop focus to <body> and
    // send the next Tab back to the top of the page. Remember which control
    // had it and hand focus back to its replacement.
    var focusedAction = document.activeElement &&
      overlay.contains(document.activeElement) &&
      document.activeElement.getAttribute('data-call-action');

    var html =
      '<div class="tma-call__live" data-call-live role="status" aria-live="assertive"></div>';

    if (mode === MODES.INCOMING) html += renderIncoming();
    else if (mode === MODES.MODAL) html += renderModal();
    else if (mode === MODES.COMPACT) html += renderCompact();
    else html += renderIsland();

    overlay.innerHTML = html;

    if (focusedAction) {
      var again = overlay.querySelector('[data-call-action="' + focusedAction + '"]');
      if (again) again.focus();
    }

    var slot = overlay.querySelector('[data-call-media-slot]');
    if (slot) slot.appendChild(mediaLayer);

    syncMediaLayer();
    attachStreams();
    applyCompactPos();
    applyPillPos();

    if (mode === MODES.MODAL || mode === MODES.INCOMING) captureFocus();
    else releaseFocus();

    publishCallPhase();
    tickDuration();
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

  function statusPill(on, offLabel, onLabel, icon) {
    // Never colour alone (§21): the label and the icon both change.
    return '<span class="tma-call__status-pill' + (on ? ' is-off' : '') + '">' +
      icon + '<span>' + esc(on ? offLabel : onLabel) + '</span></span>';
  }

  /* ── Incoming: a large centered pop-up, never a screen takeover (§1,§14) ── */
  function renderIncoming() {
    var isVideo = session.media === 'video';
    var permission = session.previewError;

    return '<div class="tma-call__scrim"></div>' +
      '<div class="tma-call__dialog tma-call__dialog--incoming" role="dialog" aria-modal="true" ' +
      'aria-label="Incoming ' + (isVideo ? 'video' : 'voice') + ' call from ' + esc(session.peerName) + '">' +

      '<div class="tma-call__incoming-preview">' +
      (isVideo && !permission
        ? '<div class="tma-call__media-slot" data-call-media-slot></div>'
        : '<div class="tma-call__incoming-fallback">' +
          avatarBlock('tma-call__avatar-big') +
          (permission
            ? '<p class="tma-call__notice"><strong>' + esc(permission.title) + '</strong>' +
              '<span>' + esc(permission.message) + '</span></p>'
            : '') +
          '<div class="tma-call__media-park" data-call-media-slot aria-hidden="true"></div>' +
          '</div>') +
      '<span class="tma-call__ringing"><span class="tma-call__pulse" aria-hidden="true"></span>' +
      'Incoming ' + (isVideo ? 'video call' : 'voice call') + '</span>' +
      '</div>' +

      '<div class="tma-call__incoming-body">' +
      avatarBlock('tma-call__incoming-avatar') +
      '<div class="tma-call__incoming-meta">' +
      '<div class="tma-call__incoming-name">' + esc(session.peerName) + '</div>' +
      '<div class="tma-call__incoming-kind">Incoming ' + (isVideo ? 'video call' : 'voice call') + '</div>' +
      '</div>' +
      '<div class="tma-call__incoming-states">' +
      statusPill(session.muted, 'Mic off', 'Mic on', iconMic()) +
      (isVideo ? statusPill(session.cameraOff, 'Camera off', 'Camera on', iconVideo()) : '') +
      '</div>' +
      '</div>' +

      '<div class="tma-call__incoming-tools">' +
      '<button type="button" class="tma-call__ctrl tma-call__ctrl--sm' + (session.muted ? ' is-off' : '') +
      '" data-call-action="mute" aria-pressed="' + (session.muted ? 'true' : 'false') +
      '" aria-label="' + (session.muted ? 'Unmute microphone' : 'Mute microphone') + '">' +
      (session.muted ? iconMicOff() : iconMic()) + '</button>' +
      (isVideo
        ? '<button type="button" class="tma-call__ctrl tma-call__ctrl--sm' + (session.cameraOff ? ' is-off' : '') +
          '" data-call-action="camera" aria-pressed="' + (session.cameraOff ? 'true' : 'false') +
          '" aria-label="' + (session.cameraOff ? 'Turn camera on' : 'Turn camera off') + '">' +
          (session.cameraOff ? iconCameraOff() : iconVideo()) + '</button>'
        : '') +
      '<button type="button" class="tma-call__ctrl tma-call__ctrl--sm" data-call-action="devices" ' +
      'aria-label="Device settings">' + iconSettings() + '</button>' +
      '</div>' +

      renderDeviceSheet() +

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
    return '<div class="tma-call__scrim" data-call-action="minimize"></div>' +
      '<div class="tma-call__dialog tma-call__dialog--stage" role="dialog" aria-modal="true" ' +
      'aria-label="' + esc(callKindLabel(session.media)) + ' with ' + esc(session.peerName) + '">' +

      '<div class="tma-call__stage-head">' +
      '<div class="tma-call__stage-who">' +
      '<span class="tma-call__stage-name">' + esc(session.peerName) + '</span>' +
      '<span class="tma-call__stage-sub">' +
      '<span data-call-status>' + esc(session.statusText || '') + '</span>' +
      '<span class="tma-call__duration" data-call-duration></span>' +
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
      '<div class="tma-call__media-slot" data-call-media-slot></div>' +
      (isVideo ? '' : '<div class="tma-call__audio-face">' + avatarBlock('tma-call__avatar-big') +
        '<div class="tma-call__audio-name">' + esc(session.peerName) + '</div></div>') +
      renderUpgradePrompt() +
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
      (supportsSinkId() ? ctrl('devices', iconSpeaker(), false, 'Audio and device settings') : '') +
      ctrl('swap', iconSwap(), false, 'Swap the large and small video', !isVideo) +
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

  function qualityBadge() {
    if (!session.quality || !session.connected) return '';
    var label = { good: 'Good connection', fair: 'Fair connection', poor: 'Weak connection' }[session.quality];
    return '<span class="tma-call__quality tma-call__quality--' + session.quality + '" title="' + esc(label) + '">' +
      iconSignal() + '<span class="tma-call__quality-label">' + esc(label) + '</span></span>';
  }

  /* ── Bottom-left compact window (§7, §8) ── */
  function renderCompact() {
    var isVideo = session.media === 'video';
    return '<div class="tma-call__compact" role="dialog" aria-label="' +
      esc(callKindLabel(session.media)) + ' with ' + esc(session.peerName) + '">' +

      '<div class="tma-call__compact-bar">' +
      '<button type="button" class="tma-call__compact-btn" data-call-action="restore" ' +
      'aria-label="Return to the previous call view">' + iconBack() + '</button>' +
      '<button type="button" class="tma-call__compact-btn" data-call-action="mode-modal" ' +
      'aria-label="Open the large call window">' + iconExpand() + '</button>' +
      '<button type="button" class="tma-call__compact-btn" data-call-action="mode-island" ' +
      'aria-label="Switch to Dynamic Island">' + iconIsland() + '</button>' +
      '<span class="tma-call__compact-grip" data-call-drag aria-hidden="true">' + iconMove() + '</span>' +
      '<button type="button" class="tma-call__compact-btn tma-call__compact-btn--end" ' +
      'data-call-action="hangup" aria-label="End call">' + iconHangup() + '</button>' +
      '</div>' +

      '<div class="tma-call__compact-body">' +
      (isVideo
        ? '<div class="tma-call__media-slot" data-call-media-slot></div>'
        // A voice call has no picture, but the media layer still has to live
        // somewhere: it carries the remote *audio* element, and a layout that
        // dropped it would silence the call.
        : '<div class="tma-call__compact-face">' + avatarBlock('tma-call__compact-avatar') +
          '<div class="tma-call__media-park" data-call-media-slot aria-hidden="true"></div></div>') +
      '</div>' +

      '<div class="tma-call__compact-foot">' +
      '<span class="tma-call__compact-name">' + esc(session.peerName) + '</span>' +
      '<span class="tma-call__compact-meta">' +
      '<span class="tma-call__compact-kind">' + esc(callKindLabel(session.media)) + '</span>' +
      '<span class="tma-call__duration" data-call-duration></span>' +
      '</span>' +
      '</div>' +

      '<div class="tma-call__compact-controls">' +
      ctrl('mute', session.muted ? iconMicOff() : iconMic(), session.muted,
        session.muted ? 'Unmute microphone' : 'Mute microphone') +
      ctrl('camera', isVideo && !session.cameraOff ? iconVideo() : iconCameraOff(),
        isVideo && session.cameraOff,
        isVideo ? (session.cameraOff ? 'Turn camera on' : 'Turn camera off') : 'Switch to video') +
      '</div>' +

      renderUpgradePrompt() +
      renderErrorPanel() +
      '</div>';
  }

  /* ── Dynamic Island (§9) — the original capsule, kept as it was ── */
  function renderIsland() {
    var isVideo = session.media === 'video';
    return '<div class="tma-call__pill tma-call__pill--' + pillPos + '" role="dialog" ' +
      'aria-label="' + esc(callKindLabel(session.media)) + ' with ' + esc(session.peerName) + '">' +
      '<button type="button" class="tma-call__pill-body" data-call-action="mode-modal" ' +
      'aria-label="Open the large call window">' +
      avatarBlock('tma-call__pill-avatar') +
      '<span class="tma-call__pill-meta">' +
      '<span class="tma-call__pill-name">' + esc(session.peerName) + '</span>' +
      '<span class="tma-call__pill-status">' +
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
      '<button type="button" class="tma-call__pill-btn" data-call-action="mode-compact" ' +
      'aria-label="Move call to the compact window">' + iconCompact() + '</button>' +
      '<button type="button" class="tma-call__pill-end" data-call-action="hangup" ' +
      'aria-label="End call">' + iconHangup() + '</button>' +
      '</div>' +
      // The media layer still needs a home while the island is showing, or the
      // remote audio element would be detached and the call would go silent.
      '<div class="tma-call__media-park" data-call-media-slot aria-hidden="true"></div>' +
      renderUpgradePrompt() +
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
    } else if (e.kind === 'declined') {
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
   * Icons — the existing set, plus the ones the new controls need. Same
   * single-path, currentColor style so tinting and sizing stay in CSS.
   * ------------------------------------------------------------------ */

  function svg(inner) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }
  function path(d) { return '<path fill="currentColor" d="' + d + '"/>'; }

  function iconPhone() {
    return svg(path('M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z'));
  }
  function iconVideo() {
    return svg(path('M4 6h11a2 2 0 0 1 2 2v2.2l3.3-2.3c.5-.4 1.2 0 1.2.6v7c0 .6-.7 1-1.2.6L17 13.8V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'));
  }
  function iconCameraOff() {
    return svg(path('M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-3-3H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.2-1.8L2.1 3.5zM8.8 6H15a2 2 0 0 1 2 2v2.2l3.3-2.3c.5-.4 1.2 0 1.2.6v7c0 .3-.2.6-.5.8L8.8 6z'));
  }
  function iconHangup() {
    return svg(path('M12 9c-1.7 0-3.4.3-5 .8V13c0 .5-.3.9-.7 1l-2.3.6c-.5.1-1-.1-1.2-.6C2.3 12.3 2 10.7 2 9c0-.6.4-1 .9-1.1C5.7 6.9 8.8 6.3 12 6.3s6.3.6 9.1 1.6c.5.1.9.5.9 1.1 0 1.7-.3 3.3-.8 5-.2.5-.7.7-1.2.6L17.7 14c-.4-.1-.7-.5-.7-1V9.8C15.4 9.3 13.7 9 12 9z'));
  }
  function iconMic() {
    return svg(path('M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12h-2z'));
  }
  function iconMicOff() {
    return svg(path('M3.5 2.1 2.1 3.5l4.9 4.9V12a5 5 0 0 0 7.6 4.3l1.5 1.5A7 7 0 0 1 5 12H3a9 9 0 0 0 8 8.9V23h2v-2.1a8.9 8.9 0 0 0 3.5-1.2l3 3 1.4-1.4L3.5 2.1zM15 11.8V6a3 3 0 0 0-5.9-.7l5.9 6.5z'));
  }
  function iconMinimize() {
    return svg(path('M6 13h12a1 1 0 0 1 0 2H6a1 1 0 0 1 0-2z'));
  }
  function iconExpand() {
    return svg(path('M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z'));
  }
  function iconCompact() {
    return svg(path('M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v10h9V7H4z'));
  }
  function iconIsland() {
    return svg(path('M7 8h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8z'));
  }
  function iconSwap() {
    return svg(path('M7 7h9l-2.3-2.3L15.1 3.3 19.8 8l-4.7 4.7-1.4-1.4L16 9H7V7zm10 10H8l2.3 2.3-1.4 1.4L4.2 16l4.7-4.7 1.4 1.4L8 15h9v2z'));
  }
  function iconMore() {
    return svg(path('M6 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'));
  }
  function iconSpeaker() {
    return svg(path('M11 5 6.5 8.5H3v7h3.5L11 19V5zm4.5 2.6a6 6 0 0 1 0 8.8l-1.4-1.4a4 4 0 0 0 0-6l1.4-1.4zm2.8-2.8a10 10 0 0 1 0 14.4l-1.4-1.4a8 8 0 0 0 0-11.6l1.4-1.4z'));
  }
  function iconSettings() {
    return svg(path('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4c0-.5 0-1-.1-1.4l2-1.6-2-3.4-2.4 1a7.9 7.9 0 0 0-2.4-1.4L15.7 2h-3.9l-.4 2.6c-.9.3-1.7.8-2.4 1.4l-2.4-1-2 3.4 2 1.6a8.3 8.3 0 0 0 0 2.9l-2 1.6 2 3.4 2.4-1c.7.6 1.5 1.1 2.4 1.4l.4 2.6h3.9l.4-2.6c.9-.3 1.7-.8 2.4-1.4l2.4 1 2-3.4-2-1.6c.1-.5.1-1 .1-1.4z'));
  }
  function iconClose() {
    return svg(path('M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5z'));
  }
  function iconBack() {
    return svg(path('M10.8 5.4 12.2 6.8 8 11h11v2H8l4.2 4.2-1.4 1.4L4.2 12l6.6-6.6z'));
  }
  function iconSignal() {
    return svg('<path fill="currentColor" d="M3 17h3v4H3v-4z"/>' +
      '<path fill="currentColor" opacity=".85" d="M9 13h3v8H9v-8z"/>' +
      '<path fill="currentColor" opacity=".7" d="M15 9h3v12h-3V9z"/>' +
      '<path fill="currentColor" opacity=".55" d="M21 4h-3v17h3V4z"/>');
  }
  function iconMove() {
    return svg(path('M12 2l3 3h-2v6h6V9l3 3-3 3v-2h-6v6h2l-3 3-3-3h2v-6H5v2l-3-3 3-3v2h6V5H9l3-3z'));
  }

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
   * The compact window's resting place (§19). It starts clear of the sidebar
   * and of the toast stack, and any position the user drags it to is kept for
   * the rest of the session, clamped back into view on resize.
   */
  function defaultCompactPos(w, h) {
    var sidebar = document.querySelector('.tma-dash__sidebar');
    var left = (sidebar ? sidebar.getBoundingClientRect().right : 0) + 16;
    return {
      x: Math.max(16, Math.min(window.innerWidth - w - 16, left)),
      y: Math.max(16, window.innerHeight - h - 96),
    };
  }

  function applyCompactPos() {
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

    minimize: function () { minimize(); },
    restore: function () { minimize(); },
    'mode-modal': function () { setMode(MODES.MODAL); },
    'mode-compact': function () { setMode(MODES.COMPACT); },
    'mode-island': function () { setMode(MODES.ISLAND); },

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

  function wireOverlay() {
    if (wired || !overlay) return;
    wired = true;

    overlay.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-call-action]');
      if (!btn || !overlay.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      var fn = ACTIONS[btn.getAttribute('data-call-action')];
      if (fn && session) fn(btn);
    });

    overlay.addEventListener('change', function (e) {
      var sel = e.target.closest('[data-call-device]');
      if (!sel) return;
      switchDevice(sel.getAttribute('data-call-device'), sel.value);
    });

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
      if (session.mode === MODES.MODAL) { minimize(); e.preventDefault(); }
      return;
    }
    if (e.key === 'Tab' && overlay &&
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
    if (!overlay) return [];
    return Array.prototype.slice.call(overlay.querySelectorAll(
      'button:not([disabled]), select:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return el.offsetParent !== null; });
  }

  function captureFocus() {
    if (!overlay) return;
    if (!lastFocus) lastFocus = document.activeElement;
    var items = focusables();
    if (items.length && !overlay.contains(document.activeElement)) items[0].focus();
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
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
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
    if (!session || session.media !== 'video') return;
    session.swapped = !session.swapped;
    // The dragged position belongs to the corner, not to whichever frame is
    // currently in it, so it carries over to the new small video.
    syncMediaLayer();
    announce(session.swapped ? 'Your video is now the large one' : session.peerName + ' is now the large video');
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
    if (session.videoSender) session.videoSender.replaceTrack(track).catch(function () {});
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
    if (session.videoSender) session.videoSender.replaceTrack(null).catch(function () {});
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

  function startCall(conversationId, media, peerName, peerAvatar) {
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
    // The caller hears the same tone back while it rings, which is the only
    // signal that the call is actually going somewhere. It is started from the
    // click, so autoplay policy never blocks this side.
    startRinging();
    beginOutgoing();
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
      initiatorId: session.initiatorId || null,
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
      // the moment somebody picked up is the wrong sound.
      stopRinging();
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
    // into their photo (§4).
    if (type === 'state') {
      session.remoteMuted = !!body.muted;
      session.remoteCameraOff = !!body.cameraOff;
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
        if (session.videoSender) session.videoSender.replaceTrack(null).catch(function () {});
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
    end: function () { endSession(true); },
    onSignal: onSignal,
    bindConversation: bindConversation,
    isActive: function () { return !!session; },
    /* Let the page request permissions eagerly too (e.g. from a call button). */
    prime: primeCallEnvironment,
    /* Settings write-through: the preference is read on the next answered call. */
    setDisplayPreference: function (mode) {
      if (mode === MODES.MODAL || mode === MODES.COMPACT || mode === MODES.ISLAND) {
        writeStore('tma.call.display', mode);
        if (window.TMAMessagingSettings) window.TMAMessagingSettings.callDisplay = mode;
      }
    },
    /* Exposed for the browser tests, which drive the UI without a real peer. */
    _debug: function () { return { session: session, mode: session && session.mode, meter: !!meter }; },
  };
})();
