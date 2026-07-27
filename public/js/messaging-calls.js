/*
 * TMA - Voice/video calls for Messages (WebRTC + conversation signalling).
 * Global: window.TMAMessagingCalls
 */
(function () {
  'use strict';

  var ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  var session = null;
  var overlay = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function api() {
    return window.TMAMessagingAPI;
  }

  function teardownMedia() {
    if (!session) return;
    if (session.localStream) {
      session.localStream.getTracks().forEach(function (t) { t.stop(); });
    }
    if (session.pc) {
      try { session.pc.close(); } catch (e) { /* ignore */ }
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
      api().callSignal(convId, { type: 'hangup', media: media }).catch(function () {});
    }
    teardownMedia();
    session = null;
    closeOverlay();
  }

  function renderOverlay(state) {
    closeOverlay();
    overlay = document.createElement('div');
    overlay.className = 'tma-msg-call';
    overlay.innerHTML =
      '<div class="tma-msg-call__panel">' +
      '<div class="tma-msg-call__title">' + esc(state.title) + '</div>' +
      '<div class="tma-msg-call__status">' + esc(state.status) + '</div>' +
      '<div class="tma-msg-call__videos">' +
      '<video class="tma-msg-call__remote" data-call-remote autoplay playsinline></video>' +
      '<video class="tma-msg-call__local" data-call-local autoplay playsinline muted></video>' +
      '</div>' +
      '<div class="tma-msg-call__actions">' +
      (state.incoming
        ? '<button type="button" class="tma-msg-call__accept" data-call-accept>Accept</button>' +
          '<button type="button" class="tma-msg-call__reject" data-call-reject>Decline</button>'
        : '<button type="button" class="tma-msg-call__hangup" data-call-hangup>End call</button>') +
      '</div></div>';
    document.body.appendChild(overlay);

    if (session && session.localStream) {
      var local = overlay.querySelector('[data-call-local]');
      if (local) local.srcObject = session.localStream;
    }
    if (session && session.remoteStream) {
      var remote = overlay.querySelector('[data-call-remote]');
      if (remote) remote.srcObject = session.remoteStream;
    }

    var hangup = overlay.querySelector('[data-call-hangup]');
    if (hangup) hangup.addEventListener('click', function () { endSession(true); });
    var reject = overlay.querySelector('[data-call-reject]');
    if (reject) {
      reject.addEventListener('click', function () {
        if (session && api()) {
          api().callSignal(session.conversationId, { type: 'reject', media: session.media }).catch(function () {});
        }
        teardownMedia();
        session = null;
        closeOverlay();
      });
    }
    var accept = overlay.querySelector('[data-call-accept]');
    if (accept) {
      accept.addEventListener('click', function () {
        acceptIncoming();
      });
    }
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
      if (overlay) {
        var remote = overlay.querySelector('[data-call-remote]');
        if (remote) remote.srcObject = session.remoteStream;
      }
    };

    pc.onicecandidate = function (ev) {
      if (!ev.candidate || !api()) return;
      api().callSignal(session.conversationId, {
        type: 'ice',
        media: session.media,
        payload: { candidate: ev.candidate.toJSON() },
      }).catch(function () {});
    };

    return pc;
  }

  function getMedia(media) {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: media === 'video',
    });
  }

  function startCall(conversationId, media, peerName) {
    if (session) {
      endSession(true);
    }
    media = media === 'video' ? 'video' : 'audio';
    session = {
      conversationId: conversationId,
      media: media,
      role: 'caller',
      peerName: peerName || 'Contact',
    };

    renderOverlay({
      title: (media === 'video' ? 'Video call' : 'Voice call') + ' · ' + peerName,
      status: 'Calling…',
      incoming: false,
    });

    getMedia(media)
      .then(function (stream) {
        if (!session) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        session.localStream = stream;
        if (overlay) {
          var local = overlay.querySelector('[data-call-local]');
          if (local) local.srcObject = stream;
        }
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
        renderOverlay({
          title: 'Call failed',
          status: (err && err.message) || 'Could not start call',
          incoming: false,
        });
        setTimeout(function () { endSession(false); }, 2200);
      });
  }

  function acceptIncoming() {
    if (!session || session.role !== 'callee') return;
    getMedia(session.media)
      .then(function (stream) {
        if (!session) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        session.localStream = stream;
        ensurePeer();
        if (overlay) {
          var local = overlay.querySelector('[data-call-local]');
          if (local) local.srcObject = stream;
        }
        return api().callSignal(session.conversationId, { type: 'accept', media: session.media });
      })
      .then(function () {
        if (!session || !session.remoteOffer) return;
        return session.pc.setRemoteDescription(session.remoteOffer).then(function () {
          return session.pc.createAnswer();
        }).then(function (answer) {
          return session.pc.setLocalDescription(answer).then(function () {
            return api().callSignal(session.conversationId, {
              type: 'answer',
              media: session.media,
              payload: { sdp: answer },
            });
          });
        });
      })
      .then(function () {
        if (!session) return;
        renderOverlay({
          title: (session.media === 'video' ? 'Video call' : 'Voice call') + ' · ' + session.peerName,
          status: 'Connected',
          incoming: false,
        });
      })
      .catch(function () {
        endSession(true);
      });
  }

  function onSignal(payload, meId) {
    if (!payload || payload.fromUserId === meId) return;
    var type = payload.type;
    var convId = payload.conversationId;
    var media = (payload.payload && payload.payload.media) || 'audio';
    var fromName = (payload.payload && payload.payload.fromName) || 'Contact';

    if (type === 'ring' || type === 'offer') {
      if (session && session.conversationId !== convId) return;
      if (!session) {
        session = {
          conversationId: convId,
          media: media,
          role: 'callee',
          peerName: fromName,
          remoteOffer: payload.payload && payload.payload.sdp ? payload.payload.sdp : null,
        };
        renderOverlay({
          title: (media === 'video' ? 'Incoming video' : 'Incoming call') + ' · ' + fromName,
          status: 'Ringing…',
          incoming: true,
        });
      } else if (type === 'offer' && payload.payload && payload.payload.sdp) {
        session.remoteOffer = payload.payload.sdp;
      }
      return;
    }

    if (!session || session.conversationId !== convId) return;

    if (type === 'answer' && session.pc && payload.payload && payload.payload.sdp) {
      session.pc.setRemoteDescription(payload.payload.sdp).then(function () {
        renderOverlay({
          title: (session.media === 'video' ? 'Video call' : 'Voice call') + ' · ' + session.peerName,
          status: 'Connected',
          incoming: false,
        });
      }).catch(function () {});
      return;
    }

    if (type === 'ice' && session.pc && payload.payload && payload.payload.candidate) {
      session.pc.addIceCandidate(payload.payload.candidate).catch(function () {});
      return;
    }

    if (type === 'hangup' || type === 'reject') {
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
