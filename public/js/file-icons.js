/*
 * TMA - File type icon paths (TMA Office marks + phosphor media)
 * Global: window.TMAFileIcons
 *
 * TMA file marks (Figma 32730:413851–413858):
 * DocxIcon, XlsxIcon, PptIcon, OnenoteIcon, FormIcon, TxtIcon, SearchIcon, Notepad
 */
(function (global) {
  'use strict';

  var PHOSPHOR = 'images/icons/phosphor/';
  var TMA = 'images/icons/tma/';

  var TMA_BY_EXT = {
    doc: 'DocxIcon.svg',
    docx: 'DocxIcon.svg',
    xls: 'XlsxIcon.svg',
    xlsx: 'XlsxIcon.svg',
    csv: 'XlsxIcon.svg',
    ppt: 'PptIcon.svg',
    pptx: 'PptIcon.svg',
    one: 'OnenoteIcon.svg',
    onetoc2: 'OnenoteIcon.svg',
    txt: 'TxtIcon.svg',
    md: 'TxtIcon.svg',
    markdown: 'TxtIcon.svg',
    rtf: 'TxtIcon.svg',
    log: 'TxtIcon.svg',
    form: 'FormIcon.svg',
  };

  var PHOSPHOR_BY_EXT = {
    pdf: 'FilePdf.svg',
    jpg: 'FileImage.svg',
    jpeg: 'FileImage.svg',
    png: 'FileImage.svg',
    gif: 'FileImage.svg',
    webp: 'FileImage.svg',
    svg: 'FileImage.svg',
    avif: 'FileImage.svg',
    heic: 'FileImage.svg',
    heif: 'FileImage.svg',
    bmp: 'FileImage.svg',
    tif: 'FileImage.svg',
    tiff: 'FileImage.svg',
    ico: 'FileImage.svg',
    js: 'FileJs.svg',
    mjs: 'FileJs.svg',
    cjs: 'FileJs.svg',
    jsx: 'FileJsx.svg',
    ts: 'FileTs.svg',
    tsx: 'FileTsx.svg',
    vue: 'FileVue.svg',
    rs: 'FileRs.svg',
    css: 'FileCss.svg',
    scss: 'FileCss.svg',
    sass: 'FileCss.svg',
    less: 'FileCss.svg',
    html: 'FileHtml.svg',
    htm: 'FileHtml.svg',
    sql: 'FileSql.svg',
    json: 'FileCode.svg',
    xml: 'FileCode.svg',
    yml: 'FileCode.svg',
    yaml: 'FileCode.svg',
    toml: 'FileCode.svg',
    php: 'FileCode.svg',
    py: 'FileCode.svg',
    rb: 'FileCode.svg',
    go: 'FileCode.svg',
    java: 'FileCode.svg',
    kt: 'FileCode.svg',
    swift: 'FileCode.svg',
    c: 'FileCode.svg',
    h: 'FileCode.svg',
    cpp: 'FileCode.svg',
    hpp: 'FileCode.svg',
    cs: 'FileCode.svg',
    sh: 'FileCode.svg',
    bash: 'FileCode.svg',
    zsh: 'FileCode.svg',
    ps1: 'FileCode.svg',
    scpt: 'FileCode.svg',
    applescript: 'FileCode.svg',
    zip: 'FileZip.svg',
    rar: 'FileZip.svg',
    '7z': 'FileZip.svg',
    tar: 'FileZip.svg',
    gz: 'FileZip.svg',
    bz2: 'FileZip.svg',
    mp3: 'FileAudio.svg',
    wav: 'FileAudio.svg',
    m4a: 'FileAudio.svg',
    flac: 'FileAudio.svg',
    ogg: 'FileAudio.svg',
    aac: 'FileAudio.svg',
    mp4: 'FileVideo.svg',
    mov: 'FileVideo.svg',
    avi: 'FileVideo.svg',
    mkv: 'FileVideo.svg',
    webm: 'FileVideo.svg',
    m4v: 'FileVideo.svg',
  };

  var ICON_SRC = {
    FileDoc: TMA + 'DocxIcon.svg',
    FileXls: TMA + 'XlsxIcon.svg',
    FilePpt: TMA + 'PptIcon.svg',
    FileCsv: TMA + 'XlsxIcon.svg',
    FileTxt: TMA + 'TxtIcon.svg',
    FileText: TMA + 'TxtIcon.svg',
    FileOneNote: TMA + 'OnenoteIcon.svg',
    FileForm: TMA + 'FormIcon.svg',
    FileNote: TMA + 'Notepad.svg',
    FileNotepad: TMA + 'Notepad.svg',
    FileSearch: TMA + 'SearchIcon.svg',
    File: TMA + 'DefaultIcon.svg',
    FileGeneric: TMA + 'DefaultIcon.svg',
    DefaultIcon: TMA + 'DefaultIcon.svg',
    DocxIcon: TMA + 'DocxIcon.svg',
    XlsxIcon: TMA + 'XlsxIcon.svg',
    PptIcon: TMA + 'PptIcon.svg',
    OnenoteIcon: TMA + 'OnenoteIcon.svg',
    FormIcon: TMA + 'FormIcon.svg',
    TxtIcon: TMA + 'TxtIcon.svg',
    Notepad: TMA + 'Notepad.svg',
    SearchIcon: TMA + 'SearchIcon.svg',
    SnowIcon: TMA + 'SnowIcon.svg',
    Word: TMA + 'DocxIcon.svg',
    Excel: TMA + 'XlsxIcon.svg',
    PowerPoint: TMA + 'PptIcon.svg',
    OneNote: TMA + 'OnenoteIcon.svg',
    MicrosoftWordLogo: TMA + 'DocxIcon.svg',
    MicrosoftExcelLogo: TMA + 'XlsxIcon.svg',
    MicrosoftPowerPointLogo: TMA + 'PptIcon.svg',
    FilePdf: PHOSPHOR + 'FilePdf.svg',
    FileImage: PHOSPHOR + 'FileImage.svg',
    FileJpg: PHOSPHOR + 'FileJpg.svg',
    FilePng: PHOSPHOR + 'FilePng.svg',
    FolderFilled: PHOSPHOR + 'FolderFilled.svg',
    FolderEmpty: PHOSPHOR + 'FolderEmpty.svg',
    FolderNotch: PHOSPHOR + 'FolderNotch.svg',
  };

  function extFromName(name) {
    var match = String(name || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function fileIconFromFilename(name) {
    var ext = extFromName(name);
    if (!ext) return '';
    if (TMA_BY_EXT[ext]) return TMA + TMA_BY_EXT[ext];
    if (PHOSPHOR_BY_EXT[ext]) return PHOSPHOR + PHOSPHOR_BY_EXT[ext];
    return TMA + 'DefaultIcon.svg';
  }

  /*
   * Marks that carry their own colour: the Acrobat red, the Office blues and
   * greens, the image gradient. Everything else in the set is ink — either
   * `fill="currentColor"`, which an <img> renders black, or a flat black
   * default — and ink is what a dark ground needs flipped.
   *
   * The distinction has to be drawn somewhere, and it belongs here, beside the
   * map that chose the file. A dark-mode rule that flipped every fallback icon
   * turned the PDF badge cyan and Word orange: an inverted brand mark is not a
   * dark-mode brand mark, it is the wrong logo.
   */
  var COLOUR_MARKS = /(FilePdf|FileImage|FileJpg|FilePng|DocxIcon|XlsxIcon|PptIcon|OnenoteIcon|FormIcon|TxtIcon)\.svg(\?|$)/i;

  /** Is this icon ink we may flip, rather than art we must not touch? */
  function isMonoIcon(src) {
    return !COLOUR_MARKS.test(String(src || ''));
  }

  function fileIconSrc(key, filename) {
    if (filename) {
      var fromName = fileIconFromFilename(filename);
      if (fromName) return fromName;
    }
    if (!key) return '';
    if (ICON_SRC[key]) return ICON_SRC[key];
    if (key.indexOf('/') !== -1) return key;
    var name = key.endsWith('.svg') ? key : key + '.svg';
    return PHOSPHOR + name;
  }

  global.TMAFileIcons = {
    PHOSPHOR: PHOSPHOR,
    TMA: TMA,
    fileIconSrc: fileIconSrc,
    fileIconFromFilename: fileIconFromFilename,
    isMonoIcon: isMonoIcon,
  };
})(typeof window !== 'undefined' ? window : this);
