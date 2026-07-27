/*
 * TMA - Voice/video calls for Messages (WebRTC + conversation signalling).
 * Global: window.TMAMessagingCalls
 *
 * UI model (modern, "today's" call UX):
 *   - Incoming call arrives as an answerable toast pinned bottom-left.
 *   - Answering (or placing a call) opens a full-screen stage.
 *   - The stage can be minimized to a small floating pill, bottom-left,
 *     that expands back to full screen on click.
 *
 * Signalling is deliberately race-tolerant: remote ICE candidates that land
 * before the peer connection has a remote description are buffered and
 * flushed once it does, and "Accept" works even if it is clicked before the
 * caller's offer has arrived (the answer is created the moment it does).
 */
(function () {
  'use strict';

  var ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  var session = null;
  var overlay = null;

  // Where the minimized island sits. Cycled by the move button and remembered
  // across calls so it stays clear of whatever it was blocking (e.g. the search
  // bar). Order runs top→bottom, so each tap walks it to the next spot.
  var PILL_POSITIONS = ['tc', 'tr', 'br', 'bc', 'bl', 'tl'];
  var pillPos = (function () {
    try { return localStorage.getItem('tma.call.pillPos') || 'tc'; } catch (e) { return 'tc'; }
  })();

  function cyclePillPos() {
    var i = PILL_POSITIONS.indexOf(pillPos);
    pillPos = PILL_POSITIONS[(i + 1) % PILL_POSITIONS.length];
    try { localStorage.setItem('tma.call.pillPos', pillPos); } catch (e) { /* ignore */ }
    applyPillPos();
  }

  function applyPillPos() {
    if (!overlay) return;
    var pill = overlay.querySelector('.tma-call__pill');
    if (!pill) return;
    PILL_POSITIONS.forEach(function (p) { pill.classList.remove('tma-call__pill--' + p); });
    pill.classList.add('tma-call__pill--' + pillPos);
  }
  // The signed-in user's id, learned from the realtime binding / signalling so
  // a persisted call can record who placed it (incoming vs outgoing in the log).
  var meId = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function api() {
    return window.TMAMessagingAPI;
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function callKindLabel(media) {
    return media === 'video' ? 'Video call' : 'Voice call';
  }

  /* ---------------------------------------------------------- media/peer */

  function teardownMedia() {
    if (!session) return;
    if (session.localStream) {
      session.localStream.getTracks().forEach(function (t) { t.stop(); });
    }
    if (session.pc) {
      try { session.pc.close(); } catch (e) { /* ignore */ }
    }
  }

  function stopTimer() {
    if (session && session.timer) {
      clearInterval(session.timer);
      session.timer = null;
    }
  }

  function closeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function endSession(sendHangup) {
    if (!session) {
      closeOverlay();
      return;
    }
    var convId = session.conversationId;
    var media = session.media;
    if (sendHangup && api()) {
      api().callSignal(convId, {
        type: 'hangup',
        media: media,
        initiatorId: session.initiatorId || null,
        answered: !!session.connected,
      }).catch(function () {});
    }
    stopTimer();
    teardownMedia();
    session = null;
    closeOverlay();
  }

  function getMedia(media) {
    // getUserMedia only exists in a secure context (https, or localhost). On a
    // plain-http LAN origin navigator.mediaDevices is undefined, which would
    // otherwise throw synchronously; return a rejection with a clear reason so
    // callers can handle it uniformly.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('Camera/mic need a secure (https) connection'));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: media === 'video',
    });
  }

  function flushCandidates() {
    if (!session || !session.pc || !session.candidates) return;
    var pc = session.pc;
    // Only safe to add once a remote description exists.
    if (!pc.remoteDescription || !pc.remoteDescription.type) return;
    var queued = session.candidates;
    session.candidates = [];
    queued.forEach(function (candidate) {
      pc.addIceCandidate(candidate).catch(function () {});
    });
  }

  /*
   * Coerce whatever arrived over the wire into a clean { type, sdp } dict.
   * The SDP survives one or more JSON round-trips fine, but the *wrapper* can
   * drift: it may come through as a JSON string, or double-nested as
   * { sdp: { type, sdp } } — the latter makes the browser read `.sdp` as an
   * object, stringify it to "[object Object]" and throw "Invalid SDP line".
   */
  function toDescription(raw, fallbackType) {
    var desc = raw;
    if (typeof desc === 'string') {
      try { desc = JSON.parse(desc); } catch (e) { return null; }
    }
    if (!desc || typeof desc !== 'object') return null;
    // Unwrap an accidental extra { sdp: {...} } layer.
    if (desc.sdp && typeof desc.sdp === 'object') desc = desc.sdp;
    if (typeof desc.sdp !== 'string' || !desc.sdp) return null;

    // Canonicalize line endings. SDP must be a sequence of `x=value` lines
    // separated by CRLF with no blank lines; a signalling round-trip can leave
    // stray lone `\r`s or doubled newlines that the parser rejects as an
    // "Invalid SDP line". Collapsing any run of CR/LF and rejoining fixes it.
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

    if (session.localStream) {
      session.localStream.getTracks().forEach(function (track) {
        pc.addTrack(track, session.localStream);
      });
    }

    pc.ontrack = function (ev) {
      ev.streams[0].getTracks().forEach(function (t) {
        session.remoteStream.addTrack(t);
      });
      attachStreams();
    };

    pc.onicecandidate = function (ev) {
      if (!ev.candidate || !api()) return;
      api().callSignal(session.conversationId, {
        type: 'ice',
        media: session.media,
        payload: { candidate: ev.candidate.toJSON() },
      }).catch(function () {});
    };

    pc.onconnectionstatechange = function () {
      if (!session || session.pc !== pc) return;
      var st = pc.connectionState;
      if (st === 'connected') {
        markConnected();
      } else if (st === 'disconnected') {
        setStatus('Reconnecting…');
      } else if (st === 'failed') {
        setStatus('Connection lost');
      }
    };

    // Fallback for browsers that fire iceconnectionstatechange first (or don't
    // reliably surface connectionState) — either path counts as connected.
    pc.oniceconnectionstatechange = function () {
      if (!session || session.pc !== pc) return;
      var st = pc.iceConnectionState;
      if (st === 'connected' || st === 'completed') markConnected();
    };

    return pc;
  }

  function markConnected() {
    if (!session || session.connected) return;
    session.connected = true;
    session.startedAt = Date.now();
    setStatus(formatDuration(0));
    stopTimer();
    session.timer = setInterval(function () {
      if (!session || !session.startedAt) return;
      setStatus(formatDuration(Date.now() - session.startedAt));
    }, 1000);

    // Once the call is live, drop to the compact top pill automatically — the
    // full-screen stage is opt-in from there (tap the pill to expand).
    setMinimized(true);
  }

  function formatDuration(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  /* --------------------------------------------------------------- views */

  function attachStreams() {
    if (!overlay || !session) return;
    var local = overlay.querySelector('[data-call-local]');
    if (local && session.localStream && local.srcObject !== session.localStream) {
      local.srcObject = session.localStream;
    }
    var remote = overlay.querySelector('[data-call-remote]');
    if (remote && session.remoteStream && remote.srcObject !== session.remoteStream) {
      remote.srcObject = session.remoteStream;
    }
  }

  function setStatus(text) {
    if (!overlay) return;
    overlay.querySelectorAll('[data-call-status]').forEach(function (node) {
      node.textContent = text;
    });
    if (session) session.statusText = text;
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'tma-call';
    document.body.appendChild(overlay);
    return overlay;
  }

  function avatarMarkup(cls) {
    if (session && session.peerAvatar) {
      return '<span class="' + cls + '"><img src="' + esc(session.peerAvatar) +
        '" alt="" referrerpolicy="no-referrer"></span>';
    }
    return '<span class="' + cls + ' ' + cls + '--initials">' +
      esc(initials(session && session.peerName)) + '</span>';
  }

  /* Incoming, answerable toast — bottom-left. */
  function renderIncoming() {
    ensureOverlay();
    stopTimer();
    overlay.className = 'tma-call tma-call--incoming';
    overlay.innerHTML =
      '<div class="tma-call__toast" role="dialog" aria-label="Incoming call">' +
      '<div class="tma-call__toast-head">' +
      avatarMarkup('tma-call__toast-avatar') +
      '<div class="tma-call__toast-meta">' +
      '<div class="tma-call__toast-name">' + esc(session.peerName) + '</div>' +
      '<div class="tma-call__toast-kind"><span class="tma-call__pulse" aria-hidden="true"></span>' +
      'Incoming ' + (session.media === 'video' ? 'video call' : 'voice call') + '</div>' +
      '</div></div>' +
      '<div class="tma-call__toast-actions">' +
      '<button type="button" class="tma-call__btn tma-call__btn--decline" data-call-reject aria-label="Decline">' +
      iconHangup() + '<span>Decline</span></button>' +
      '<button type="button" class="tma-call__btn tma-call__btn--accept" data-call-accept aria-label="Accept">' +
      (session.media === 'video' ? iconVideo() : iconPhone()) + '<span>Accept</span></button>' +
      '</div></div>';
    wireControls();
  }

  /* Full-screen active stage (with a collapsible minimized pill). */
  function renderActive() {
    ensureOverlay();
    var minimized = session && session.minimized;
    overlay.className = 'tma-call tma-call--active tma-call--' + (session.media === 'video' ? 'video' : 'audio') +
      (minimized ? ' is-minimized' : '');

    var statusText = (session && session.statusText) || 'Calling…';

    overlay.innerHTML =
      // Full-screen stage
      '<div class="tma-call__stage" role="dialog" aria-label="' + esc(callKindLabel(session.media)) + '">' +
      '<button type="button" class="tma-call__minimize" data-call-minimize aria-label="Minimize call">' +
      iconMinimize() + '</button>' +
      '<div class="tma-call__stage-inner">' +
      '<div class="tma-call__videos">' +
      '<video class="tma-call__remote" data-call-remote autoplay playsinline></video>' +
      '<div class="tma-call__avatar-wrap">' + avatarMarkup('tma-call__avatar-big') + '</div>' +
      '<video class="tma-call__local" data-call-local autoplay playsinline muted></video>' +
      '</div>' +
      '<div class="tma-call__peer">' +
      '<div class="tma-call__peer-name">' + esc(session.peerName) + '</div>' +
      '<div class="tma-call__peer-status" data-call-status>' + esc(statusText) + '</div>' +
      '</div>' +
      '<div class="tma-call__controls">' +
      '<button type="button" class="tma-call__ctrl' + (session.muted ? ' is-off' : '') + '" data-call-mute aria-label="Toggle microphone">' +
      iconMic() + '</button>' +
      (session.media === 'video'
        ? '<button type="button" class="tma-call__ctrl' + (session.cameraOff ? ' is-off' : '') + '" data-call-camera aria-label="Toggle camera">' + iconVideo() + '</button>'
        : '') +
      '<button type="button" class="tma-call__ctrl tma-call__ctrl--end" data-call-hangup aria-label="End call">' +
      iconHangup() + '</button>' +
      '</div>' +
      '</div></div>' +
      // Minimized pill
      '<div class="tma-call__pill tma-call__pill--' + pillPos + '" role="dialog" aria-label="Call in progress">' +
      '<button type="button" class="tma-call__pill-body" data-call-expand aria-label="Expand call">' +
      avatarMarkup('tma-call__pill-avatar') +
      '<span class="tma-call__pill-meta">' +
      '<span class="tma-call__pill-name">' + esc(session.peerName) + '</span>' +
      '<span class="tma-call__pill-status" data-call-status>' + esc(statusText) + '</span>' +
      '</span></button>' +
      '<button type="button" class="tma-call__pill-move" data-call-move aria-label="Move call" title="Move call">' +
      iconMove() + '</button>' +
      '<button type="button" class="tma-call__pill-mic' + (session.muted ? ' is-off' : '') +
      '" data-call-mute aria-label="Toggle microphone">' + iconMic() + '</button>' +
      '<button type="button" class="tma-call__pill-end" data-call-hangup aria-label="End call">' +
      iconHangup() + '</button>' +
      '</div>';

    wireControls();
    attachStreams();
  }

  function setMinimized(minimized) {
    if (!session) return;
    session.minimized = !!minimized;
    if (!overlay) return;
    overlay.classList.toggle('is-minimized', session.minimized);
  }

  /* --------------------------------------------------------- control wiring */

  function wireControls() {
    if (!overlay) return;

    bind('[data-call-accept]', function () { acceptIncoming(); });
    bind('[data-call-reject]', function () {
      if (session && api()) {
        api().callSignal(session.conversationId, {
          type: 'reject',
          media: session.media,
          initiatorId: session.initiatorId || null,
          answered: false,
        }).catch(function () {});
      }
      stopTimer();
      teardownMedia();
      session = null;
      closeOverlay();
    });
    bind('[data-call-hangup]', function () { endSession(true); });
    bind('[data-call-minimize]', function () { setMinimized(true); });
    bind('[data-call-expand]', function () { setMinimized(false); });
    bind('[data-call-mute]', function () { toggleMute(); });
    bind('[data-call-camera]', function () { toggleCamera(); });
    bind('[data-call-move]', function () { cyclePillPos(); });
  }

  function bind(selector, handler) {
    overlay.querySelectorAll(selector).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        handler(btn);
      });
    });
  }

  function syncToggle(selector, off) {
    if (!overlay) return;
    overlay.querySelectorAll(selector).forEach(function (b) {
      b.classList.toggle('is-off', off);
    });
  }

  function toggleMute() {
    if (!session || !session.localStream) return;
    session.muted = !session.muted;
    session.localStream.getAudioTracks().forEach(function (t) { t.enabled = !session.muted; });
    // Keep every mute control (stage + pill) in step.
    syncToggle('[data-call-mute]', session.muted);
  }

  function toggleCamera() {
    if (!session || !session.localStream) return;
    session.cameraOff = !session.cameraOff;
    session.localStream.getVideoTracks().forEach(function (t) { t.enabled = !session.cameraOff; });
    syncToggle('[data-call-camera]', session.cameraOff);
  }

  /* --------------------------------------------------------------- icons */

  function svg(inner) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' + inner + '</svg>';
  }
  function iconPhone() {
    return svg('<path fill="currentColor" d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z"/>');
  }
  function iconVideo() {
    return svg('<path fill="currentColor" d="M4 6h11a2 2 0 0 1 2 2v2.2l3.3-2.3c.5-.4 1.2 0 1.2.6v7c0 .6-.7 1-1.2.6L17 13.8V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>');
  }
  function iconHangup() {
    return svg('<path fill="currentColor" d="M12 9c-1.7 0-3.4.3-5 .8V13c0 .5-.3.9-.7 1l-2.3.6c-.5.1-1-.1-1.2-.6C2.3 12.3 2 10.7 2 9c0-.6.4-1 .9-1.1C5.7 6.9 8.8 6.3 12 6.3s6.3.6 9.1 1.6c.5.1.9.5.9 1.1 0 1.7-.3 3.3-.8 5-.2.5-.7.7-1.2.6L17.7 14c-.4-.1-.7-.5-.7-1V9.8C15.4 9.3 13.7 9 12 9z"/>');
  }
  function iconMic() {
    return svg('<path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12h-2z"/>');
  }
  function iconMinimize() {
    return svg('<path fill="currentColor" d="M6 13h8a1 1 0 0 1 0 2H6a1 1 0 0 1 0-2z"/>');
  }
  function iconMove() {
    // Four-way move arrows.
    return svg('<path fill="currentColor" d="M12 2l3 3h-2v6h6V9l3 3-3 3v-2h-6v6h2l-3 3-3-3h2v-6H5v2l-3-3 3-3v2h6V5H9l3-3z"/>');
  }

  /* --------------------------------------------------------- call actions */

  function startCall(conversationId, media, peerName, peerAvatar) {
    if (session) {
      endSession(true);
    }
    media = media === 'video' ? 'video' : 'audio';
    session = {
      conversationId: conversationId,
      media: media,
      role: 'caller',
      initiatorId: meId,
      peerName: peerName || 'Contact',
      peerAvatar: peerAvatar || null,
      candidates: [],
      statusText: 'Calling…',
    };

    renderActive();

    getMedia(media)
      .then(function (stream) {
        if (!session) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        session.localStream = stream;
        attachStreams();
        ensurePeer();
        return api().callSignal(conversationId, { type: 'ring', media: media });
      })
      .then(function () {
        if (!session) return;
        return session.pc.createOffer().then(function (offer) {
          return session.pc.setLocalDescription(offer).then(function () {
            return api().callSignal(conversationId, {
              type: 'offer',
              media: media,
              payload: { sdp: offer },
            });
          });
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || 'Could not start call');
        setTimeout(function () { endSession(false); }, 2200);
      });
  }

  function acceptIncoming() {
    if (!session || session.role !== 'callee') return;
    session.accepting = true;
    // Swap the toast for the full-screen stage right away so the tap feels live.
    session.statusText = 'Connecting…';
    session.minimized = false;
    renderActive();

    // Try for local media, but do not let its absence drop the call: if the
    // mic/camera is denied or busy (common when both ends run on one machine),
    // join receive-only so the caller can still be heard, rather than ending.
    getMedia(session.media)
      .catch(function (err) {
        console.warn('TMA call: local media unavailable, joining receive-only —', err && err.name, err && err.message);
        setStatus('Mic/camera unavailable — listening only');
        return null;
      })
      .then(function (stream) {
        if (!session) {
          if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        if (stream) session.localStream = stream;
        ensurePeer();
        attachStreams();
        if (api()) {
          api().callSignal(session.conversationId, { type: 'accept', media: session.media }).catch(function () {});
        }
        // The offer may already be here, or may still be in flight. Answer now
        // if we can; otherwise onSignal() answers the moment it arrives.
        return maybeAnswer();
      })
      .catch(function (err) {
        console.error('TMA call: accept failed —', err);
        setStatus('Could not connect: ' + ((err && (err.name || err.message)) || 'unknown'));
        setTimeout(function () { endSession(true); }, 6000);
      });
  }

  /*
   * Create and send the SDP answer, but only once both the local media and the
   * caller's offer are available. Callable more than once — it no-ops until the
   * preconditions are met and after it has already answered.
   */
  function maybeAnswer() {
    if (!session || session.role !== 'callee' || session.answered) return;
    // Local media is intentionally NOT required — a receive-only answer is
    // valid and lets the callee join even when their mic/camera is unavailable.
    if (!session.accepting || !session.remoteOffer || !session.pc) return;

    var offer = toDescription(session.remoteOffer, 'offer');
    if (!offer) {
      console.error('TMA call: unusable offer —', session.remoteOffer);
      setStatus('Could not connect: bad offer');
      setTimeout(function () { endSession(true); }, 6000);
      return;
    }

    session.answered = true;
    return session.pc.setRemoteDescription(offer)
      .then(function () {
        flushCandidates();
        return session.pc.createAnswer();
      })
      .then(function (answer) {
        return session.pc.setLocalDescription(answer).then(function () {
          if (api()) {
            return api().callSignal(session.conversationId, {
              type: 'answer',
              media: session.media,
              payload: { sdp: answer },
            });
          }
        });
      })
      .catch(function (err) {
        if (session) session.answered = false;
        console.error('TMA call: failed to answer —', err);
        setStatus('Could not connect');
        setTimeout(function () { endSession(true); }, 2500);
      });
  }

  /* --------------------------------------------------------- signalling in */

  function onSignal(payload, viewerId) {
    if (viewerId != null) meId = viewerId;
    if (!payload || payload.fromUserId === meId) return;
    var type = payload.type;
    var convId = payload.conversationId;
    var media = (payload.payload && payload.payload.media) || 'audio';
    // Prefer the peer info the messages layer resolved locally (it has the
    // caller's photo); fall back to the name the caller stamped on the signal.
    var fromName = payload._peerName || (payload.payload && payload.payload.fromName) || 'Contact';
    var fromPhoto = payload._peerPhoto || null;

    if (type === 'ring' || type === 'offer') {
      if (session && session.conversationId !== convId) return;
      if (!session) {
        session = {
          conversationId: convId,
          media: media,
          role: 'callee',
          initiatorId: payload.fromUserId || null,
          peerName: fromName,
          peerAvatar: fromPhoto,
          candidates: [],
          statusText: 'Ringing…',
          remoteOffer: payload.payload && payload.payload.sdp ? payload.payload.sdp : null,
        };
        renderIncoming();
      } else if (type === 'offer' && payload.payload && payload.payload.sdp) {
        session.remoteOffer = payload.payload.sdp;
        // If the callee already tapped Accept, answer now that the offer is in.
        maybeAnswer();
      }
      return;
    }

    if (!session || session.conversationId !== convId) return;

    if (type === 'accept') {
      // Callee picked up: caller stays on the stage, waiting for the answer.
      if (session.role === 'caller') setStatus('Connecting…');
      return;
    }

    if (type === 'answer' && session.pc && payload.payload && payload.payload.sdp) {
      var answer = toDescription(payload.payload.sdp, 'answer');
      if (!answer) {
        console.error('TMA call: unusable answer —', payload.payload.sdp);
        return;
      }
      session.pc.setRemoteDescription(answer)
        .then(function () {
          flushCandidates();
          if (!session.connected) setStatus('Connecting…');
        })
        .catch(function (err) {
          console.error('TMA call: failed to apply answer —', err);
        });
      return;
    }

    if (type === 'ice' && payload.payload && payload.payload.candidate) {
      // Buffer until there is a peer connection with a remote description; a
      // candidate added too early throws and the media never connects.
      if (!session.candidates) session.candidates = [];
      session.candidates.push(payload.payload.candidate);
      if (session.pc) flushCandidates();
      return;
    }

    if (type === 'hangup' || type === 'reject') {
      stopTimer();
      teardownMedia();
      session = null;
      closeOverlay();
    }
  }

  function bindConversation(realtime, conversationId, meId) {
    if (!realtime || !conversationId) return;
    var channel = 'private-conversation.' + conversationId;
    realtime.listen(channel, 'call.signal', function (payload) {
      onSignal(payload, meId);
    });
  }

  window.TMAMessagingCalls = {
    start: startCall,
    end: function () { endSession(true); },
    onSignal: onSignal,
    bindConversation: bindConversation,
  };
})();
