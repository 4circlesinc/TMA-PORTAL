/*
 * TMA - Voice note recorder for the Messages composer.
 *
 * Wraps MediaRecorder and the Web Audio API: capture, a live duration, and
 * waveform peaks sampled while recording. Peaks are measured here because the
 * server has no media probe — computing them after upload would mean decoding
 * the audio again on every render instead of once, at source.
 *
 * Container support differs by browser (Chrome gives WebM/Opus, Safari MP4),
 * so the first supported type is chosen rather than assumed.
 *
 * Global: window.TMAVoiceRecorder
 */
(function () {
  'use strict';

  /* In preference order; the first the browser can encode wins. */
  var CANDIDATE_TYPES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/mpeg',
  ];

  /* Matches AttachmentIntake::WAVEFORM_POINTS — one bar per slot. */
  var WAVEFORM_POINTS = 60;

  /* Hard stop, mirroring the server's ceiling. */
  var MAX_MS = 10 * 60 * 1000;

  function supportedMimeType() {
    if (typeof MediaRecorder === 'undefined') return null;

    for (var i = 0; i < CANDIDATE_TYPES.length; i++) {
      if (MediaRecorder.isTypeSupported(CANDIDATE_TYPES[i])) return CANDIDATE_TYPES[i];
    }
    // Let the browser pick if it supports recording but none of the above.
    return '';
  }

  function isSupported() {
    return !!(
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  /*
   * Turn a getUserMedia rejection into something worth showing a person.
   * "NotAllowedError" on its own tells the user nothing about what to do.
   */
  function describeError(err) {
    var name = (err && err.name) || '';

    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Microphone access was blocked. Allow it in your browser’s site settings to record.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No microphone was found. Connect one and try again.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'Your microphone is in use by another application.';
    }
    if (name === 'OverconstrainedError') {
      return 'Your microphone does not support the required settings.';
    }

    return 'Recording could not start on this device.';
  }

  function Recorder() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.peaks = [];
    this.startedAt = 0;
    this.pausedMs = 0;
    this.pausedAt = 0;
    this.audioContext = null;
    this.analyser = null;
    this.sampler = null;
    this.state = 'idle'; // idle | recording | paused
  }

  Recorder.prototype.isSupported = isSupported;

  Recorder.prototype.elapsedMs = function () {
    if (!this.startedAt) return 0;
    var end = this.state === 'paused' ? this.pausedAt : Date.now();
    return Math.max(0, end - this.startedAt - this.pausedMs);
  };

  /**
   * Begin recording.
   *
   * `onTick` is called roughly ten times a second with the elapsed
   * milliseconds, so the composer can show a live counter without polling.
   * Rejects with a human-readable message.
   */
  Recorder.prototype.start = function (onTick) {
    var self = this;

    if (!isSupported()) {
      return Promise.reject(new Error('Recording is not supported by this browser.'));
    }

    return navigator.mediaDevices
      .getUserMedia({ audio: true })
      .catch(function (err) {
        throw new Error(describeError(err));
      })
      .then(function (stream) {
        self.stream = stream;
        self.chunks = [];
        self.peaks = [];
        self.pausedMs = 0;
        self.pausedAt = 0;

        var mimeType = supportedMimeType();
        self.recorder = mimeType
          ? new MediaRecorder(stream, { mimeType: mimeType })
          : new MediaRecorder(stream);

        self.recorder.addEventListener('dataavailable', function (e) {
          if (e.data && e.data.size) self.chunks.push(e.data);
        });

        self.startedAt = Date.now();
        self.state = 'recording';
        self.recorder.start();

        self.watchLevels();

        self.sampler = setInterval(function () {
          if (self.state !== 'recording') return;
          if (onTick) onTick(self.elapsedMs());
          // Stop at the ceiling rather than letting a forgotten recording run.
          if (self.elapsedMs() >= MAX_MS) self.stop();
        }, 100);

        return true;
      });
  };

  /*
   * Sample loudness while recording so the sent note carries a waveform.
   *
   * Peaks are collected continuously and reduced to WAVEFORM_POINTS at the
   * end, so the bar chart spans the whole recording however long it ran.
   */
  Recorder.prototype.watchLevels = function () {
    var self = this;

    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;

      this.audioContext = new Ctx();
      var source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      var buffer = new Uint8Array(this.analyser.frequencyBinCount);

      var sample = function () {
        if (self.state === 'idle' || !self.analyser) return;

        if (self.state === 'recording') {
          self.analyser.getByteTimeDomainData(buffer);

          // Peak deviation from the 128 midpoint, as 0-100.
          var peak = 0;
          for (var i = 0; i < buffer.length; i++) {
            var delta = Math.abs(buffer[i] - 128);
            if (delta > peak) peak = delta;
          }
          self.peaks.push(Math.min(100, Math.round((peak / 128) * 100)));
        }

        requestAnimationFrame(sample);
      };

      requestAnimationFrame(sample);
    } catch (err) {
      // Levels are decorative; recording continues without a waveform.
    }
  };

  Recorder.prototype.pause = function () {
    if (this.state !== 'recording' || !this.recorder) return;
    try {
      this.recorder.pause();
    } catch (err) {
      return;
    }
    this.pausedAt = Date.now();
    this.state = 'paused';
  };

  Recorder.prototype.resume = function () {
    if (this.state !== 'paused' || !this.recorder) return;
    try {
      this.recorder.resume();
    } catch (err) {
      return;
    }
    this.pausedMs += Date.now() - this.pausedAt;
    this.pausedAt = 0;
    this.state = 'recording';
  };

  /** Stop and resolve with { blob, durationMs, waveform, mimeType }. */
  Recorder.prototype.stop = function () {
    var self = this;

    if (!this.recorder || this.state === 'idle') {
      return Promise.resolve(null);
    }

    var durationMs = this.elapsedMs();

    return new Promise(function (resolve) {
      self.recorder.addEventListener(
        'stop',
        function () {
          var mimeType = self.recorder.mimeType || 'audio/webm';
          var blob = new Blob(self.chunks, { type: mimeType });
          var waveform = self.reducePeaks();

          self.release();

          resolve({
            blob: blob,
            durationMs: durationMs,
            waveform: waveform,
            mimeType: mimeType,
          });
        },
        { once: true }
      );

      try {
        self.recorder.stop();
      } catch (err) {
        self.release();
        resolve(null);
      }
    });
  };

  /** Abandon the recording and free the microphone without producing a file. */
  Recorder.prototype.cancel = function () {
    if (this.recorder && this.state !== 'idle') {
      try {
        this.recorder.stop();
      } catch (err) {
        /* already stopped */
      }
    }
    this.chunks = [];
    this.peaks = [];
    this.release();
  };

  /*
   * Release the microphone.
   *
   * Every track must be stopped explicitly — leaving them open keeps the
   * browser's recording indicator lit, which reads as the app still listening.
   */
  Recorder.prototype.release = function () {
    if (this.stream) {
      this.stream.getTracks().forEach(function (track) {
        track.stop();
      });
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (err) {
        /* ignore */
      }
    }
    if (this.sampler) clearInterval(this.sampler);

    this.stream = null;
    this.recorder = null;
    this.analyser = null;
    this.audioContext = null;
    this.sampler = null;
    this.startedAt = 0;
    this.state = 'idle';
  };

  /** Reduce however many samples were taken to a fixed-width bar chart. */
  Recorder.prototype.reducePeaks = function () {
    var peaks = this.peaks;
    if (!peaks.length) return [];

    var out = [];
    var per = peaks.length / WAVEFORM_POINTS;

    for (var i = 0; i < WAVEFORM_POINTS; i++) {
      var from = Math.floor(i * per);
      var to = Math.max(from + 1, Math.floor((i + 1) * per));
      var peak = 0;
      for (var j = from; j < to && j < peaks.length; j++) {
        if (peaks[j] > peak) peak = peaks[j];
      }
      out.push(peak);
    }

    return out;
  };

  window.TMAVoiceRecorder = {
    create: function () {
      return new Recorder();
    },
    isSupported: isSupported,
    WAVEFORM_POINTS: WAVEFORM_POINTS,
    MAX_MS: MAX_MS,
  };
})();
