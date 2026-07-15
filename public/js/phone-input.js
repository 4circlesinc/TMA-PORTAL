/*
 * Country-aware phone fields. Attaches itself to every phone input in the
 * portal - static or rendered later - and, as the user types, names the
 * country the number belongs to (flag + name + dial code) and tidies the
 * formatting on blur. Detection is by ITU dial code, with the +1 area codes
 * split out so Caribbean numbers name the right island rather than "US".
 *
 * Global: window.TMAPhone ({ describe, format, enhance })
 */
(function () {
  'use strict';

  /* dial code -> ISO 3166 region (longest-prefix match wins) */
  var CODES = {
    '7': 'RU', '20': 'EG', '27': 'ZA', '30': 'GR', '31': 'NL', '32': 'BE', '33': 'FR', '34': 'ES',
    '36': 'HU', '39': 'IT', '40': 'RO', '41': 'CH', '43': 'AT', '44': 'GB', '45': 'DK', '46': 'SE',
    '47': 'NO', '48': 'PL', '49': 'DE', '51': 'PE', '52': 'MX', '53': 'CU', '54': 'AR', '55': 'BR',
    '56': 'CL', '57': 'CO', '58': 'VE', '60': 'MY', '61': 'AU', '62': 'ID', '63': 'PH', '64': 'NZ',
    '65': 'SG', '66': 'TH', '81': 'JP', '82': 'KR', '84': 'VN', '86': 'CN', '90': 'TR', '91': 'IN',
    '92': 'PK', '93': 'AF', '94': 'LK', '95': 'MM', '98': 'IR',
    '211': 'SS', '212': 'MA', '213': 'DZ', '216': 'TN', '218': 'LY', '220': 'GM', '221': 'SN',
    '222': 'MR', '223': 'ML', '224': 'GN', '225': 'CI', '226': 'BF', '227': 'NE', '228': 'TG',
    '229': 'BJ', '230': 'MU', '231': 'LR', '232': 'SL', '233': 'GH', '234': 'NG', '235': 'TD',
    '236': 'CF', '237': 'CM', '238': 'CV', '239': 'ST', '240': 'GQ', '241': 'GA', '242': 'CG',
    '243': 'CD', '244': 'AO', '245': 'GW', '248': 'SC', '249': 'SD', '250': 'RW', '251': 'ET',
    '252': 'SO', '253': 'DJ', '254': 'KE', '255': 'TZ', '256': 'UG', '257': 'BI', '258': 'MZ',
    '260': 'ZM', '261': 'MG', '262': 'RE', '263': 'ZW', '264': 'NA', '265': 'MW', '266': 'LS',
    '267': 'BW', '268': 'SZ', '269': 'KM', '290': 'SH', '291': 'ER', '297': 'AW', '298': 'FO',
    '299': 'GL', '350': 'GI', '351': 'PT', '352': 'LU', '353': 'IE', '354': 'IS', '355': 'AL',
    '356': 'MT', '357': 'CY', '358': 'FI', '359': 'BG', '370': 'LT', '371': 'LV', '372': 'EE',
    '373': 'MD', '374': 'AM', '375': 'BY', '376': 'AD', '377': 'MC', '378': 'SM', '380': 'UA',
    '381': 'RS', '382': 'ME', '383': 'XK', '385': 'HR', '386': 'SI', '387': 'BA', '389': 'MK',
    '420': 'CZ', '421': 'SK', '423': 'LI', '500': 'FK', '501': 'BZ', '502': 'GT', '503': 'SV',
    '504': 'HN', '505': 'NI', '506': 'CR', '507': 'PA', '508': 'PM', '509': 'HT', '590': 'GP',
    '591': 'BO', '592': 'GY', '593': 'EC', '594': 'GF', '595': 'PY', '596': 'MQ', '597': 'SR',
    '598': 'UY', '599': 'CW', '670': 'TL', '673': 'BN', '674': 'NR', '675': 'PG', '676': 'TO',
    '677': 'SB', '678': 'VU', '679': 'FJ', '680': 'PW', '682': 'CK', '685': 'WS', '686': 'KI',
    '687': 'NC', '689': 'PF', '691': 'FM', '692': 'MH', '850': 'KP', '852': 'HK', '853': 'MO',
    '855': 'KH', '856': 'LA', '880': 'BD', '886': 'TW', '960': 'MV', '961': 'LB', '962': 'JO',
    '963': 'SY', '964': 'IQ', '965': 'KW', '966': 'SA', '967': 'YE', '968': 'OM', '970': 'PS',
    '971': 'AE', '972': 'IL', '973': 'BH', '974': 'QA', '975': 'BT', '976': 'MN', '977': 'NP',
    '992': 'TJ', '993': 'TM', '994': 'AZ', '995': 'GE', '996': 'KG', '998': 'UZ',
  };

  /* +1 is shared: these area codes are not the US */
  var NANP = {
    '242': 'BS', '246': 'BB', '264': 'AI', '268': 'AG', '284': 'VG', '340': 'VI', '345': 'KY',
    '441': 'BM', '473': 'GD', '649': 'TC', '658': 'JM', '664': 'MS', '671': 'GU', '684': 'AS',
    '721': 'SX', '758': 'LC', '767': 'DM', '784': 'VC', '787': 'PR', '809': 'DO', '829': 'DO',
    '849': 'DO', '868': 'TT', '869': 'KN', '876': 'JM', '939': 'PR',
  };

  var CANADA = ['204', '226', '236', '249', '250', '289', '306', '343', '365', '403', '416', '418',
    '431', '437', '438', '450', '506', '514', '519', '548', '579', '581', '587', '604', '613',
    '639', '647', '672', '705', '709', '778', '780', '782', '807', '819', '825', '867', '873',
    '902', '905'];

  var names;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { names = null; }

  function regionName(iso) {
    try { return (names && names.of(iso)) || iso; } catch (e) { return iso; }
  }

  function flag(iso) {
    return iso.replace(/./g, function (c) {
      return String.fromCodePoint(127397 + c.charCodeAt(0));
    });
  }

  /* keep one leading +, digits only after it; treat 00... as + */
  function clean(value) {
    var v = String(value || '').replace(/[^0-9+]/g, '');
    if (v.indexOf('00') === 0) v = '+' + v.slice(2);
    return v.charAt(0) === '+' ? '+' + v.slice(1).replace(/\+/g, '') : v;
  }

  function nanpInfo(area) {
    var iso = NANP[area] || (CANADA.indexOf(area) !== -1 ? 'CA' : null);
    if (iso) return { iso: iso, name: regionName(iso), flag: flag(iso), dial: '+1 ' + area };
    if (area.length === 3) return { iso: 'US', name: regionName('US'), flag: flag('US'), dial: '+1 ' + area };
    return { iso: null, name: 'US or Canada', flag: flag('US'), dial: '+1' };
  }

  /* what country is this number from?
     Numbers without "+" are read as North American: typing an area code like
     758 is enough - it resolves to the island and +1 is added for the user. */
  function describe(value) {
    var v = clean(value);
    if (v.charAt(0) !== '+') {
      if (/^[2-9]\d{2}/.test(v)) return nanpInfo(v.slice(0, 3));
      return null;
    }
    var d = v.slice(1);
    if (!d) return null;

    if (d.charAt(0) === '1') return nanpInfo(d.slice(1, 4));

    for (var len = 3; len >= 1; len--) {
      var code = d.slice(0, len);
      if (CODES[code]) {
        return { iso: CODES[code], name: regionName(CODES[code]), flag: flag(CODES[code]), dial: '+' + code };
      }
    }
    return null;
  }

  function format(value) {
    var v = clean(value);
    if (v.charAt(0) !== '+') {
      if (/^[2-9]\d{2}/.test(v)) v = '+1' + v;      /* 758... -> +1 758... */
      else return String(value || '').trim();
    }
    var d = v.slice(1);

    /* NANP: +1 758 555-0100 */
    if (d.charAt(0) === '1') {
      var rest = d.slice(1);
      return ('+1 ' + rest.slice(0, 3) + ' ' + rest.slice(3, 6) +
        (rest.length > 6 ? '-' + rest.slice(6, 10) : '') + (rest.length > 10 ? ' ' + rest.slice(10) : '')).trim();
    }

    var info = describe(v);
    var code = info ? info.dial.slice(1) : d.slice(0, 2);
    var tail = d.slice(code.length);
    var groups = [];
    while (tail.length > 4) { groups.push(tail.slice(0, 3)); tail = tail.slice(3); }
    if (tail) groups.push(tail);
    return ('+' + code + ' ' + groups.join(' ')).trim();
  }

  /* ── the hint lives inside the field's own block, under the input ── */
  function hintFor(input) {
    var host = input.closest('label, .tma-user-info-panel__field') || input.parentNode;
    var hint = host.querySelector ? host.querySelector('[data-phone-hint]') : null;
    if (!hint) {
      hint = document.createElement('span');
      hint.className = 'tma-phone-hint';
      hint.setAttribute('data-phone-hint', '');
      host.appendChild(hint);
    }
    return hint;
  }

  function paint(input) {
    var hint = hintFor(input);
    var v = clean(input.value);
    if (!v) { hint.textContent = ''; hint.hidden = true; return; }
    var info = describe(v);
    if (info) {
      hint.textContent = info.flag + ' ' + info.name + ' \u00b7 ' + info.dial;
    } else if (v.charAt(0) === '+') {
      hint.textContent = 'Keep typing\u2026';
    } else {
      hint.textContent = 'Include a country code, like +1 758.';
    }
    hint.hidden = false;
  }

  function enhance(input) {
    if (!input || input.dataset.phoneEnhanced) return;
    input.dataset.phoneEnhanced = '1';
    input.addEventListener('input', function () {
      /* format live while the caret is at the end - typing 758 becomes
         +1 758 without the user doing anything */
      var atEnd = input.selectionStart === input.value.length;
      var v = clean(input.value);
      if (atEnd && (v.charAt(0) === '+' || /^[2-9]\d{2}/.test(v))) {
        var next = format(input.value);
        if (next !== input.value) {
          input.value = next;
          try { input.setSelectionRange(next.length, next.length); } catch (e) {}
        }
      }
      paint(input);
    });
    input.addEventListener('blur', function () {
      var v = clean(input.value);
      if (v.charAt(0) === '+' || /^[2-9]\d{2}/.test(v)) input.value = format(input.value);
      paint(input);
    });
    if (input.value) paint(input);
  }

  var SELECTOR = 'input[type="tel"], input[data-pf="phone"], input[data-user-info-field="phone"]';

  function scan(root) {
    (root.querySelectorAll ? root.querySelectorAll(SELECTOR) : []).forEach(enhance);
  }

  function start() {
    scan(document);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType === 1) scan(n);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  window.TMAPhone = { describe: describe, format: format, enhance: enhance };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
