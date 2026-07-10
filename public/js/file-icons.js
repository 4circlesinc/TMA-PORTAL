/*
 * TMA — File type icon paths (TMA Office marks + phosphor media)
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
  };
})(typeof window !== 'undefined' ? window : this);
