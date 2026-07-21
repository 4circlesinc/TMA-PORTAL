/*
 * TMA - Approved folder colour palette + icon path helper
 * Global: window.TMAFolderColours
 * Mirrors App\Support\Files\FolderColours::PALETTE - keep in sync.
 */
(function (global) {
  'use strict';

  var PHOSPHOR = 'images/icons/phosphor/';

  var PALETTE = [
    { key: 'default', label: 'Default', hex: '#fec656', shade: '#ef9f2c' },
    { key: 'blue', label: 'Blue', hex: '#7dbbff', shade: '#03a5e9' },
    { key: 'green', label: 'Green', hex: '#71dd8c', shade: '#3fae63' },
    { key: 'pink', label: 'Pink', hex: '#ff90e8', shade: '#d954b8' },
    { key: 'red', label: 'Red', hex: '#ff4747', shade: '#d62d2d' },
    { key: 'teal', label: 'Teal', hex: '#6be6d3', shade: '#2fb39d' },
  ];

  var KEYS = PALETTE.reduce(function (set, c) { set[c.key] = true; return set; }, {});

  function isValid(colour) {
    return !!colour && KEYS.hasOwnProperty(colour);
  }

  // base: 'FolderFilled' | 'FolderEmpty'
  function iconSrc(base, colour) {
    if (!isValid(colour) || colour === 'default') return PHOSPHOR + base + '.svg';
    return PHOSPHOR + 'folder-colours/' + base + '-' + colour + '.svg';
  }

  function label(colour) {
    var match = PALETTE.filter(function (c) { return c.key === colour; })[0];
    return match ? match.label : 'Default';
  }

  // The darker tone of a folder's colour - used to tint the icon stamp so
  // it reads as pressed into the same material, not a random accent colour.
  function shade(colour) {
    var match = PALETTE.filter(function (c) { return c.key === colour; })[0];
    return (match || PALETTE[0]).shade;
  }

  global.TMAFolderColours = {
    PALETTE: PALETTE,
    isValid: isValid,
    iconSrc: iconSrc,
    label: label,
    shade: shade,
  };
})(typeof window !== 'undefined' ? window : this);
