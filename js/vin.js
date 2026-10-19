/* VIN utilities: validation, check digit, model year and manufacturer decoding.
   Works offline and follows the North American (49 CFR 565) VIN layout. */
(function (root) {
  'use strict';

  const TRANSLIT = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  };
  const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  // Position-10 year codes, starting at 1980 (and again at 2010).
  const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';
  const VALID_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/;

  // World manufacturer identifiers for the makes that appear most on US lots.
  const WMI = {
    '1C4': 'Jeep', '1C6': 'Ram', '1FA': 'Ford', '1FM': 'Ford', '1FT': 'Ford',
    '1G1': 'Chevrolet', '1GC': 'Chevrolet', '1GN': 'Chevrolet', '1GY': 'Cadillac',
    '1HG': 'Honda', '1N4': 'Nissan', '2GN': 'Chevrolet', '2HG': 'Honda',
    '2T2': 'Lexus', '2T3': 'Toyota', '3FA': 'Ford', '3GN': 'Chevrolet',
    '3MZ': 'Mazda', '4S4': 'Subaru', '4T1': 'Toyota', '5FN': 'Honda',
    '5J6': 'Honda', '5N1': 'Nissan', '5TD': 'Toyota', '5TF': 'Toyota',
    '5UX': 'BMW', '5XY': 'Kia', '5YJ': 'Tesla', '7FA': 'Honda', '7SA': 'Tesla',
    '3TM': 'Toyota', 'JF1': 'Subaru', 'JF2': 'Subaru', 'JHM': 'Honda', 'JM1': 'Mazda',
    'JM3': 'Mazda', 'JN1': 'Nissan', 'JTD': 'Toyota', 'JTE': 'Toyota',
    'JTJ': 'Lexus', 'JTM': 'Toyota', 'KM8': 'Hyundai', 'KNA': 'Kia',
    'KND': 'Kia', 'LPS': 'Polestar', 'SAL': 'Land Rover', 'WA1': 'Audi',
    'WAU': 'Audi', 'WBA': 'BMW', 'WBS': 'BMW', 'WDC': 'Mercedes-Benz',
    'WDD': 'Mercedes-Benz', 'W1K': 'Mercedes-Benz', 'W1N': 'Mercedes-Benz',
    'WP0': 'Porsche', 'WP1': 'Porsche', 'WVW': 'Volkswagen', 'WVG': 'Volkswagen',
    'YV1': 'Volvo', 'YV4': 'Volvo',
  };

  const REGIONS = [
    [/^[1-5]/, 'North America'], [/^[6-7]/, 'Oceania'], [/^[8-9]/, 'South America'],
    [/^[A-H]/, 'Africa'], [/^[J-R]/, 'Asia'], [/^[S-Z]/, 'Europe'],
  ];
  const COUNTRIES = {
    1: 'United States', 4: 'United States', 5: 'United States', 2: 'Canada', 3: 'Mexico',
    J: 'Japan', K: 'South Korea', L: 'China', S: 'United Kingdom', W: 'Germany', Y: 'Sweden',
  };

  // Region 7 is shared: some 7xx codes are now assigned to US plants.
  const WMI_COUNTRY = { '7FA': 'United States', '7SA': 'United States' };

  function normalize(vin) {
    return String(vin || '').toUpperCase().replace(/[\s-]/g, '');
  }

  function charValue(c) {
    return /[0-9]/.test(c) ? Number(c) : TRANSLIT[c];
  }

  function checkDigit(vin) {
    const v = normalize(vin);
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      if (i === 8) continue;
      sum += charValue(v[i]) * WEIGHTS[i];
    }
    const r = sum % 11;
    return r === 10 ? 'X' : String(r);
  }

  function isValid(vin) {
    const v = normalize(vin);
    return VALID_CHARS.test(v) && checkDigit(v) === v[8];
  }

  // Position 7 disambiguates the 30-year cycle for light vehicles:
  // a digit means 1980–2009, a letter means 2010–2039.
  function modelYear(vin) {
    const v = normalize(vin);
    const idx = YEAR_CODES.indexOf(v[9]);
    if (idx < 0) return null;
    return /[0-9]/.test(v[6]) ? 1980 + idx : 2010 + idx;
  }

  function yearCode(year) {
    return YEAR_CODES[(year - 1980) % 30];
  }

  function decode(vin) {
    const v = normalize(vin);
    const result = {
      vin: v,
      wellFormed: VALID_CHARS.test(v),
      valid: false,
      expectedCheckDigit: null,
      make: null,
      region: null,
      country: null,
      year: null,
      plant: null,
      serial: null,
      errors: [],
    };
    if (v.length !== 17) {
      result.errors.push(`A VIN has 17 characters; this one has ${v.length}.`);
      return result;
    }
    if (/[IOQ]/.test(v)) result.errors.push('VINs never contain the letters I, O or Q.');
    if (!result.wellFormed) {
      if (!result.errors.length) result.errors.push('Contains characters that are not allowed in a VIN.');
      return result;
    }
    result.expectedCheckDigit = checkDigit(v);
    result.valid = result.expectedCheckDigit === v[8];
    if (!result.valid) {
      result.errors.push(`Check digit is ${v[8]} but should be ${result.expectedCheckDigit}. A character may be mistyped.`);
    }
    result.make = WMI[v.slice(0, 3)] || null;
    result.country = WMI_COUNTRY[v.slice(0, 3)] || COUNTRIES[v[0]] || null;
    const region = REGIONS.find(([re]) => re.test(v[0]));
    result.region = result.country === 'United States' ? 'North America' : region ? region[1] : null;
    result.year = modelYear(v);
    result.plant = v[10];
    result.serial = v.slice(11);
    return result;
  }

  const api = { normalize, checkDigit, isValid, modelYear, yearCode, decode, WMI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VIN = api;
})(typeof window !== 'undefined' ? window : globalThis);
