/* Synthetic nationwide inventory. Deterministic (seeded), so every visit and
   every test sees the same market. Swap generateInventory() for a real feed. */
(function (root) {
  'use strict';

  const VIN = typeof module !== 'undefined' && module.exports ? require('./vin.js') : root.VIN;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const PALETTES = {
    Toyota: [['Super White', '#f2f2ef'], ['Midnight Black Metallic', '#17181b'], ['Magnetic Gray Metallic', '#5c5f63'], ['Silver Sky Metallic', '#b9bcc0'], ['Blueprint', '#2f4a6b'], ['Lunar Rock', '#a9a59a'], ['Barcelona Red', '#8e1b20'], ['Cavalry Blue', '#4a6273'], ['Mudbath', '#8a7a5c']],
    Lexus: [['Eminent White Pearl', '#eeece6'], ['Obsidian', '#121314'], ['Nebula Gray Pearl', '#6b6e72'], ['Starfire', '#f4f3ee'], ['Nightfall Mica', '#1c2a44'], ['Atomic Silver', '#a8abaf'], ['Fire Agate', '#a2401f'], ['Earth', '#6f6b5a']],
    Honda: [['Platinum White Pearl', '#efeee8'], ['Crystal Black Pearl', '#141518'], ['Lunar Silver Metallic', '#b5b8bb'], ['Meteorite Gray', '#55585c'], ['Still Night Pearl', '#22314d'], ['Radiant Red', '#a3141d'], ['Canyon River Blue', '#3f6b8a'], ['Urban Gray Pearl', '#73777a']],
    Ford: [['Oxford White', '#f3f3f1'], ['Agate Black', '#141414'], ['Carbonized Gray', '#4c4f53'], ['Iconic Silver', '#b4b6b8'], ['Atlas Blue', '#2f4f73'], ['Rapid Red', '#8d1a1f'], ['Eruption Green', '#3e5a3e'], ['Cyber Orange', '#c85a1a'], ['Area 51', '#6f8f9a']],
    Chevrolet: [['Summit White', '#f2f2f0'], ['Black', '#111111'], ['Sterling Gray', '#6a6c6f'], ['Silver Ice', '#b7b9bb'], ['Northsky Blue', '#2c3e5c'], ['Radiant Red', '#99151c'], ['Accelerate Yellow', '#e3b51b'], ['Rapid Blue', '#2367b2']],
    Ram: [['Bright White', '#f1f1ef'], ['Diamond Black', '#121212'], ['Granite Crystal', '#4a4d51'], ['Billet Silver', '#b0b3b6'], ['Patriot Blue', '#22345a'], ['Delmonico Red', '#7c1418'], ['Hydro Blue', '#1f6fb3']],
    Jeep: [['Bright White', '#f1f1ef'], ['Black', '#111111'], ['Granite Crystal', '#4a4d51'], ['Firecracker Red', '#b0161c'], ['Hydro Blue', '#1f6fb3'], ['Sarge Green', '#5a5d43'], ['Earl', '#8c9396'], ['Gecko', '#7fb24a']],
    Hyundai: [['Abyss Black', '#131416'], ['Hyper White', '#f1f1ee'], ['Moonlight Cloud', '#3a4252'], ['Steel Graphite', '#5f6266'], ['Rain Forest', '#3d4c3f'], ['Calypso Red', '#8e1d24']],
    Kia: [['Snow White Pearl', '#f2f1ec'], ['Ebony Black', '#121212'], ['Gravity Gray', '#575a5e'], ['Wolf Gray', '#7a7c7d'], ['Dawning Red', '#8a1c23'], ['Jungle Wood Green', '#3b4a3c'], ['Everlasting Silver', '#b7b9bb']],
    Subaru: [['Crystal White Pearl', '#f0efe9'], ['Crystal Black Silica', '#151617'], ['Magnetite Gray', '#4f5357'], ['Ice Silver', '#b6b9bc'], ['Autumn Green', '#4a5a47'], ['Sapphire Blue', '#24406b'], ['Brilliant Bronze', '#8a6a45'], ['Geyser Blue', '#7fa3a6']],
    Mazda: [['Soul Red Crystal', '#9b0f1a'], ['Snowflake White Pearl', '#f2f1ec'], ['Jet Black Mica', '#121314'], ['Machine Gray', '#5f6164'], ['Deep Crystal Blue', '#1c2b45'], ['Polymetal Gray', '#7a8287'], ['Zircon Sand', '#b5ab95'], ['Platinum Quartz', '#c8c3b8']],
    BMW: [['Alpine White', '#f4f4f2'], ['Black Sapphire', '#141518'], ['Mineral White', '#e8e8e4'], ['Carbon Black', '#1c2230'], ['Brooklyn Grey', '#8a8e90'], ['Phytonic Blue', '#28456b'], ['Ametrin', '#4a3d4f'], ['Tanzanite Blue', '#1f2440'], ['Isle of Man Green', '#1f4a3a']],
    Volvo: [['Crystal White', '#f1f1ee'], ['Onyx Black', '#121212'], ['Vapour Grey', '#8b8e90'], ['Denim Blue', '#3f5670'], ['Silver Dawn', '#b9bbbd'], ['Platinum Grey', '#6b6d6f'], ['Fusion Red', '#8a1c22'], ['Mulberry Red', '#5a1a26'], ['Sage Green', '#7d8a77']],
    Tesla: [['Pearl White', '#efefeb'], ['Solid Black', '#111111'], ['Stealth Grey', '#4b4e52'], ['Deep Blue Metallic', '#1f3a68'], ['Ultra Red', '#a3121c'], ['Quicksilver', '#a7a9ab']],
    Polestar: [['Snow', '#efefec'], ['Space', '#151515'], ['Thunder', '#55595c'], ['Magnesium', '#a6a8aa'], ['Midnight', '#1d2533'], ['Jupiter', '#c9c5bc']],
    Cadillac: [['Crystal White Tricoat', '#f1f0ea'], ['Stellar Black', '#121212'], ['Argent Silver', '#b4b6b8'], ['Opulent Blue', '#23314e'], ['Emerald Lake', '#244a44'], ['Crimson', '#7a1220']],
  };
  const INTERIORS = {
    default: ['Black', 'Black', 'Black', 'Gray', 'Gray', 'Beige', 'Brown', 'Red'],
    lux: ['Black', 'Black', 'Ivory', 'Sepia', 'Cognac', 'Blond', 'Rioja Red', 'Navy', 'Charcoal'],
  };

  const OPTION_POOL = {
    mass: [['Convenience Package', 1250], ['Technology Package', 1800], ['Moonroof', 1200], ['Premium Audio', 1100], ['Cold Weather Package', 650], ['All-Weather Floor Mats', 250], ['Roof Rails', 400], ['Tow Hitch', 750], ['19" Alloy Wheels', 1100]],
    lux: [['Premium Package', 2900], ['Driver Assistance Pro', 2100], ['Climate Package', 750], ['Panoramic Roof', 1700], ['Bowers & Wilkins Audio', 3200], ['Air Suspension', 1800], ['Head-Up Display', 1100], ['Lounge Package', 1700], ['21" Wheels', 1400], ['Protection Package', 500]],
    truck: [['Towing Package', 1495], ['Off-Road Package', 2200], ['Bed Liner', 595], ['Max Trailer Tow', 1300], ['Power Running Boards', 1100], ['Sunroof', 1495], ['360 Camera', 900], ['Pro Power Onboard', 1100]],
    sport: [['Performance Pack', 4900], ['Carbon Fiber Package', 3800], ['Magnetic Ride', 1900], ['Front Lift', 2500], ['Track Package', 3200], ['Premium Audio', 1100]],
    ev: [['Full Self-Driving', 8000], ['Premium Interior', 2000], ['Tow Package', 1000], ['20" Wheels', 2000], ['Plus Pack', 4000], ['Pilot Pack', 3400], ['Super Cruise', 2500]],
  };

  // weight = relative share of the national inventory
  const MODELS = [
    { make: 'Toyota', model: 'RAV4', body: 'SUV', seg: 'Compact SUV', wmi: '2T3', dt: ['FWD', 'AWD'], fuel: ['Gas', 'Hybrid'], dep: 0.935, years: [2017, 2026], weight: 9, opt: 'mass', trims: [['LE', 29800], ['XLE', 31900], ['XLE Premium', 35000], ['Limited', 38500], ['XSE Hybrid', 38700]] },
    { make: 'Toyota', model: '4Runner', body: 'SUV', seg: 'Midsize SUV', wmi: 'JTE', dt: ['4WD', 'RWD'], fuel: ['Gas'], dep: 0.95, years: [2014, 2026], weight: 5, opt: 'truck', trims: [['SR5', 41000], ['TRD Off-Road', 45500], ['Limited', 51500], ['TRD Pro', 57000]] },
    { make: 'Toyota', model: 'Tacoma', body: 'Truck', seg: 'Midsize Truck', wmi: '3TM', dt: ['4WD', 'RWD'], fuel: ['Gas', 'Hybrid'], dep: 0.95, years: [2016, 2026], weight: 6, opt: 'truck', trims: [['SR', 31500], ['TRD Sport', 39000], ['TRD Off-Road', 41500], ['Limited', 51500], ['TRD Pro', 65000]] },
    { make: 'Toyota', model: 'Camry', body: 'Sedan', seg: 'Midsize Sedan', wmi: '4T1', dt: ['FWD', 'AWD'], fuel: ['Gas', 'Hybrid'], dep: 0.905, years: [2017, 2026], weight: 6, opt: 'mass', trims: [['LE', 28400], ['SE', 30500], ['XSE', 34500]] },
    { make: 'Toyota', model: 'Sienna', body: 'Minivan', seg: 'Minivan', wmi: '5TD', dt: ['FWD', 'AWD'], fuel: ['Hybrid'], dep: 0.93, years: [2021, 2026], weight: 3, opt: 'mass', trims: [['LE', 39000], ['XLE', 46000], ['Woodland', 50000], ['Platinum', 55000]] },
    { make: 'Lexus', model: 'GX', body: 'SUV', seg: 'Luxury SUV', wmi: 'JTJ', dt: ['4WD'], fuel: ['Gas'], dep: 0.94, years: [2014, 2026], weight: 3, opt: 'lux', trims: [['460', 54000], ['460 Premium', 58000], ['460 Luxury', 66000], ['550 Overtrail', 70000]] },
    { make: 'Lexus', model: 'RX', body: 'SUV', seg: 'Luxury SUV', wmi: '2T2', dt: ['FWD', 'AWD'], fuel: ['Gas', 'Hybrid'], dep: 0.89, years: [2016, 2026], weight: 4, opt: 'lux', trims: [['350', 50000], ['350 Premium', 53500], ['350h', 52500], ['500h F Sport', 65000]] },
    { make: 'Honda', model: 'CR-V', body: 'SUV', seg: 'Compact SUV', wmi: '7FA', dt: ['FWD', 'AWD'], fuel: ['Gas', 'Hybrid'], dep: 0.915, years: [2017, 2026], weight: 8, opt: 'mass', trims: [['LX', 30000], ['EX', 32500], ['EX-L', 35000], ['Sport Touring Hybrid', 40500]] },
    { make: 'Honda', model: 'Civic', body: 'Sedan', seg: 'Compact Car', wmi: '2HG', dt: ['FWD'], fuel: ['Gas', 'Hybrid'], dep: 0.915, years: [2017, 2027], weight: 7, opt: 'mass', trims: [['LX', 24500], ['Sport', 26500], ['EX', 28000], ['Si', 30500], ['Type R', 45000]] },
    { make: 'Honda', model: 'Accord', body: 'Sedan', seg: 'Midsize Sedan', wmi: '1HG', dt: ['FWD'], fuel: ['Gas', 'Hybrid'], dep: 0.89, years: [2018, 2026], weight: 4, opt: 'mass', trims: [['LX', 28300], ['EX', 30500], ['Sport Hybrid', 33500], ['Touring Hybrid', 39000]] },
    { make: 'Ford', model: 'F-150', body: 'Truck', seg: 'Full-size Truck', wmi: '1FT', dt: ['4WD', 'RWD'], fuel: ['Gas', 'Hybrid'], dep: 0.9, years: [2015, 2026], weight: 10, opt: 'truck', trims: [['XL', 38500], ['XLT', 48500], ['Lariat', 63500], ['Platinum', 72500], ['Raptor', 79500]] },
    { make: 'Ford', model: 'Bronco', body: 'SUV', seg: 'Midsize SUV', wmi: '1FM', dt: ['4WD'], fuel: ['Gas'], dep: 0.92, years: [2021, 2026], weight: 4, opt: 'truck', trims: [['Big Bend', 41500], ['Badlands', 51000], ['Wildtrak', 56000], ['Raptor', 85000]] },
    { make: 'Ford', model: 'Mustang', body: 'Coupe', seg: 'Sports Car', wmi: '1FA', dt: ['RWD'], fuel: ['Gas'], dep: 0.9, years: [2015, 2026], weight: 3, opt: 'sport', trims: [['EcoBoost', 32500], ['GT', 44500], ['Dark Horse', 61500]] },
    { make: 'Chevrolet', model: 'Silverado 1500', body: 'Truck', seg: 'Full-size Truck', wmi: '1GC', dt: ['4WD', 'RWD'], fuel: ['Gas', 'Diesel'], dep: 0.89, years: [2015, 2026], weight: 9, opt: 'truck', trims: [['WT', 38500], ['LT', 50500], ['RST', 55500], ['LTZ', 60500], ['High Country', 66500]] },
    { make: 'Chevrolet', model: 'Equinox', body: 'SUV', seg: 'Compact SUV', wmi: '3GN', dt: ['FWD', 'AWD'], fuel: ['Gas'], dep: 0.85, years: [2018, 2026], weight: 6, opt: 'mass', trims: [['LS', 28500], ['LT', 30500], ['RS', 33500], ['ACTIV', 34500]] },
    { make: 'Chevrolet', model: 'Corvette', body: 'Coupe', seg: 'Sports Car', wmi: '1G1', dt: ['RWD', 'AWD'], fuel: ['Gas', 'Hybrid'], dep: 0.935, years: [2020, 2026], weight: 2, opt: 'sport', trims: [['1LT', 69000], ['2LT', 76500], ['3LT', 81500], ['Z06', 112500], ['E-Ray', 108500]] },
    { make: 'Ram', model: '1500', body: 'Truck', seg: 'Full-size Truck', wmi: '1C6', dt: ['4WD', 'RWD'], fuel: ['Gas'], dep: 0.87, years: [2016, 2026], weight: 6, opt: 'truck', trims: [['Tradesman', 41500], ['Big Horn', 46500], ['Laramie', 59500], ['Limited', 68500]] },
    { make: 'Jeep', model: 'Wrangler', body: 'SUV', seg: 'Midsize SUV', wmi: '1C4', dt: ['4WD'], fuel: ['Gas', 'Plug-in Hybrid'], dep: 0.92, years: [2016, 2026], weight: 5, opt: 'truck', trims: [['Sport', 33500], ['Sahara', 45500], ['Rubicon', 48500], ['Rubicon 392', 92500]] },
    { make: 'Hyundai', model: 'Palisade', body: 'SUV', seg: '3-Row SUV', wmi: 'KM8', dt: ['FWD', 'AWD'], fuel: ['Gas'], dep: 0.88, years: [2020, 2026], weight: 3, opt: 'mass', trims: [['SE', 38500], ['SEL', 41500], ['Limited', 50500], ['Calligraphy', 54500]] },
    { make: 'Kia', model: 'Telluride', body: 'SUV', seg: '3-Row SUV', wmi: '5XY', dt: ['FWD', 'AWD'], fuel: ['Gas'], dep: 0.905, years: [2020, 2026], weight: 4, opt: 'mass', trims: [['LX', 37500], ['EX', 43500], ['SX', 47500], ['SX X-Pro', 53500]] },
    { make: 'Subaru', model: 'Forester', body: 'SUV', seg: 'Compact SUV', wmi: 'JF2', dt: ['AWD'], fuel: ['Gas', 'Hybrid'], dep: 0.885, years: [2017, 2026], weight: 5, opt: 'mass', trims: [['Base', 28500], ['Premium', 30500], ['Sport', 33500], ['Touring', 38500]] },
    { make: 'Subaru', model: 'Outback', body: 'Wagon', seg: 'Midsize SUV', wmi: '4S4', dt: ['AWD'], fuel: ['Gas'], dep: 0.885, years: [2017, 2026], weight: 5, opt: 'mass', trims: [['Base', 30500], ['Premium', 32500], ['Onyx', 37500], ['Touring XT', 42500]] },
    { make: 'Mazda', model: 'CX-5', body: 'SUV', seg: 'Compact SUV', wmi: 'JM3', dt: ['AWD'], fuel: ['Gas'], dep: 0.885, years: [2017, 2026], weight: 5, opt: 'mass', trims: [['S', 30000], ['Select', 31500], ['Preferred', 33500], ['Turbo Signature', 40500]] },
    { make: 'Mazda', model: 'CX-50', body: 'SUV', seg: 'Compact SUV', wmi: '3MZ', dt: ['AWD'], fuel: ['Gas', 'Hybrid'], dep: 0.9, years: [2023, 2026], weight: 3, opt: 'mass', trims: [['S', 31000], ['Preferred', 34000], ['Premium Plus', 40000], ['Turbo Meridian', 43500]] },
    { make: 'Mazda', model: 'MX-5 Miata', body: 'Convertible', seg: 'Sports Car', wmi: 'JM1', dt: ['RWD'], fuel: ['Gas'], dep: 0.925, years: [2016, 2026], weight: 2, opt: 'sport', trims: [['Sport', 30500], ['Club', 34500], ['Grand Touring', 36000]] },
    { make: 'BMW', model: 'X5', body: 'SUV', seg: 'Luxury SUV', wmi: '5UX', dt: ['RWD', 'AWD'], fuel: ['Gas', 'Plug-in Hybrid'], dep: 0.84, years: [2019, 2026], weight: 4, opt: 'lux', trims: [['sDrive40i', 66500], ['xDrive40i', 68800], ['xDrive50e', 74500], ['M60i', 91500]] },
    { make: 'BMW', model: '3 Series', body: 'Sedan', seg: 'Luxury Sedan', wmi: 'WBA', dt: ['RWD', 'AWD'], fuel: ['Gas'], dep: 0.83, years: [2019, 2026], weight: 3, opt: 'lux', trims: [['330i', 45500], ['330i xDrive', 47500], ['M340i', 58500]] },
    { make: 'Volvo', model: 'XC90', body: 'SUV', seg: 'Luxury SUV', wmi: 'YV4', dt: ['AWD'], fuel: ['Gas', 'Plug-in Hybrid'], dep: 0.83, years: [2016, 2027], weight: 4, opt: 'lux', trims: [['Core', 58500], ['Plus', 64500], ['Ultra', 71500]] },
    { make: 'Volvo', model: 'XC60', body: 'SUV', seg: 'Luxury SUV', wmi: 'YV4', dt: ['AWD'], fuel: ['Gas', 'Plug-in Hybrid'], dep: 0.84, years: [2018, 2026], weight: 3, opt: 'lux', trims: [['Core', 47500], ['Plus', 51500], ['Ultra', 56500]] },
    { make: 'Tesla', model: 'Model Y', body: 'SUV', seg: 'Electric SUV', wmi: '7SA', dt: ['RWD', 'AWD'], fuel: ['Electric'], dep: 0.82, years: [2020, 2026], weight: 6, opt: 'ev', trims: [['Standard', 41500], ['Long Range', 48500], ['Performance', 53500]] },
    { make: 'Tesla', model: 'Model 3', body: 'Sedan', seg: 'Electric Sedan', wmi: '5YJ', dt: ['RWD', 'AWD'], fuel: ['Electric'], dep: 0.81, years: [2018, 2026], weight: 4, opt: 'ev', trims: [['RWD', 40500], ['Long Range', 47500], ['Performance', 55500]] },
    { make: 'Polestar', model: '2', body: 'Sedan', seg: 'Electric Sedan', wmi: 'LPS', dt: ['RWD', 'AWD'], fuel: ['Electric'], dep: 0.77, years: [2021, 2025], weight: 2, opt: 'ev', trims: [['Base', 50500], ['Long Range Dual Motor', 56500]] },
    { make: 'Cadillac', model: 'Lyriq', body: 'SUV', seg: 'Electric SUV', wmi: '1GY', dt: ['RWD', 'AWD'], fuel: ['Electric'], dep: 0.8, years: [2023, 2026], weight: 2, opt: 'ev', trims: [['Tech', 58500], ['Luxury', 64500], ['Sport', 66500]] },
  ];

  // [city, state, lat, lng]
  const CITIES = [
    ['Haverhill', 'MA', 42.77, -71.08], ['Boston', 'MA', 42.36, -71.06], ['Elmsford', 'NY', 41.05, -73.82], ['Albany', 'NY', 42.65, -73.75], ['Pawtucket', 'RI', 41.88, -71.38],
    ['Hartford', 'CT', 41.76, -72.67], ['Newark', 'NJ', 40.74, -74.17], ['Philadelphia', 'PA', 39.95, -75.17], ['Pittsburgh', 'PA', 40.44, -79.99], ['Baltimore', 'MD', 39.29, -76.61],
    ['Hampton', 'VA', 37.03, -76.35], ['Richmond', 'VA', 37.54, -77.44], ['Raleigh', 'NC', 35.78, -78.64], ['Charlotte', 'NC', 35.23, -80.84], ['Charleston', 'SC', 32.78, -79.93],
    ['Buford', 'GA', 34.12, -84.0], ['Atlanta', 'GA', 33.75, -84.39], ['Orlando', 'FL', 28.54, -81.38], ['Tampa', 'FL', 27.95, -82.46], ['Miami', 'FL', 25.76, -80.19],
    ['Nashville', 'TN', 36.16, -86.78], ['Birmingham', 'AL', 33.52, -86.8], ['Columbus', 'OH', 39.96, -83.0], ['Cleveland', 'OH', 41.5, -81.69], ['Detroit', 'MI', 42.33, -83.05],
    ['Indianapolis', 'IN', 39.77, -86.16], ['Louisville', 'KY', 38.25, -85.76], ['Schaumburg', 'IL', 42.03, -88.08], ['Chicago', 'IL', 41.88, -87.63], ['Milwaukee', 'WI', 43.04, -87.91],
    ['Minneapolis', 'MN', 44.98, -93.27], ['Des Moines', 'IA', 41.59, -93.62], ['St. Louis', 'MO', 38.63, -90.2], ['Kansas City', 'MO', 39.1, -94.58], ['Omaha', 'NE', 41.26, -95.93],
    ['Dallas', 'TX', 32.78, -96.8], ['Houston', 'TX', 29.76, -95.37], ['Austin', 'TX', 30.27, -97.74], ['Amarillo', 'TX', 35.22, -101.83], ['Oklahoma City', 'OK', 35.47, -97.52],
    ['New Orleans', 'LA', 29.95, -90.07], ['Little Rock', 'AR', 34.75, -92.29], ['Denver', 'CO', 39.74, -104.99], ['Salt Lake City', 'UT', 40.76, -111.89], ['Albuquerque', 'NM', 35.08, -106.65],
    ['Phoenix', 'AZ', 33.45, -112.07], ['Las Vegas', 'NV', 36.17, -115.14], ['Boise', 'ID', 43.62, -116.2], ['Seattle', 'WA', 47.61, -122.33], ['Portland', 'OR', 45.52, -122.68],
    ['Sacramento', 'CA', 38.58, -121.49], ['San Jose', 'CA', 37.34, -121.89], ['Los Altos', 'CA', 37.38, -122.11], ['Thousand Oaks', 'CA', 34.17, -118.84], ['San Diego', 'CA', 32.72, -117.16],
    ['Anchorage', 'AK', 61.22, -149.9], ['Honolulu', 'HI', 21.31, -157.86], ['Burlington', 'VT', 44.48, -73.21], ['Portland', 'ME', 43.66, -70.26], ['Billings', 'MT', 45.78, -108.5],
  ];
  const CITY_WEIGHTS = { CA: 3, TX: 3, FL: 2.5, NY: 2, IL: 1.6, GA: 1.6, OH: 1.6, PA: 1.6, NC: 1.5, AZ: 1.5, WA: 1.4, MI: 1.3, CO: 1.3 };
  const INDEPENDENTS = ['Auto Group', 'Motors', 'Auto Exchange', 'Car Company', 'Pre-Owned'];
  const INDIE_PREFIX = ['Summit', 'Liberty', 'Crossroads', 'Lakeside', 'Northstar', 'Redwood', 'Keystone', 'Pioneer', 'Harbor', 'Granite'];

  const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  const VIN_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

  function makeVin(rand, wmi, year) {
    let vds = '';
    for (let i = 0; i < 5; i++) {
      const pool = i === 3 ? VIN_LETTERS : VIN_CHARS; // position 7 letter => 2010+ cycle
      vds += pool[Math.floor(rand() * pool.length)];
    }
    const plant = VIN_LETTERS[Math.floor(rand() * VIN_LETTERS.length)];
    const serial = String(Math.floor(rand() * 1e6)).padStart(6, '0');
    const draft = wmi + vds + '0' + VIN.yearCode(year) + plant + serial;
    return draft.slice(0, 8) + VIN.checkDigit(draft) + draft.slice(9);
  }

  function pickWeighted(rand, items, weightOf) {
    const total = items.reduce((s, it) => s + weightOf(it), 0);
    let r = rand() * total;
    for (const it of items) {
      r -= weightOf(it);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  // Skewed index: early entries in a list are more common than later ones.
  function skewIndex(rand, n, power) {
    return Math.min(n - 1, Math.floor(Math.pow(rand(), power) * n));
  }

  const round = (n, to) => Math.round(n / to) * to;

  // Steep depreciation for the first three years, then a gentler slope.
  function retained(dep, age) {
    const late = 1 - (1 - dep) * 0.5;
    return Math.pow(dep, Math.min(age, 3)) * Math.pow(late, Math.max(0, age - 3));
  }

  function generateInventory(opts) {
    const o = Object.assign({ seed: 20261019, count: 3200, currentYear: 2026 }, opts);
    const rand = mulberry32(o.seed);
    const dealers = new Map();
    const listings = [];

    for (let i = 0; i < o.count; i++) {
      const m = pickWeighted(rand, MODELS, (x) => x.weight);
      const [minY, maxY] = m.years;
      const nextYearModel = maxY > o.currentYear;

      // Model-year mix: newer years dominate used inventory.
      let year;
      const roll = rand();
      if (nextYearModel && roll < 0.22) year = maxY;
      else if (roll < 0.42) year = Math.min(maxY, o.currentYear);
      else year = Math.max(minY, Math.min(o.currentYear, o.currentYear - 1 - skewIndex(rand, o.currentYear - minY, 1.6)));
      const age = Math.max(0, o.currentYear - year);

      const isNew = year >= o.currentYear && (year > o.currentYear || rand() < 0.82);
      const certified = !isNew && age <= 6 && rand() < 0.28;
      const condition = isNew ? 'New' : certified ? 'Certified' : 'Used';

      const trimIdx = skewIndex(rand, m.trims.length, 1.35);
      const [trim, baseMsrp] = m.trims[trimIdx];
      const msrpBase = round(baseMsrp * Math.pow(1.028, year - 2025), 5);

      const pool = OPTION_POOL[m.opt];
      const options = [];
      for (const [name, price] of pool) {
        if (rand() < 0.18 + trimIdx * 0.07) options.push({ name, price });
      }
      const optionsTotal = options.reduce((s, x) => s + x.price, 0);
      const msrp = msrpBase + optionsTotal;

      let miles;
      if (isNew) miles = Math.floor(rand() * 25);
      else {
        const perYear = 9000 + rand() * 7000;
        miles = Math.max(800, Math.round((age + 0.4) * perYear * (0.55 + rand() * 0.9)));
      }

      const palette = PALETTES[m.make];
      const [extColor, extHex] = palette[skewIndex(rand, palette.length, 1.9)];
      const intPool = m.opt === 'lux' ? INTERIORS.lux : INTERIORS.default;
      const intColor = intPool[skewIndex(rand, intPool.length, 1.5)];

      const cityW = (c) => CITY_WEIGHTS[c[1]] || 1;
      const city = pickWeighted(rand, CITIES, cityW);
      const regional = 1 + (['CA', 'HI', 'AK', 'NY', 'MA', 'WA'].includes(city[1]) ? 0.025 : 0) - (['TX', 'OK', 'AZ', 'FL', 'GA'].includes(city[1]) ? 0.015 : 0);

      let price;
      let status = null;
      if (isNew) {
        const markup = m.opt === 'sport' ? 0.03 : m.fuel[0] === 'Electric' ? -0.06 : 0;
        price = msrp * (1 + markup + (rand() - 0.62) * 0.07);
        status = pickWeighted(rand, [['On lot', 6], ['In transit', 2.5], ['In production', 1.2]], (x) => x[1])[0];
        if (year > o.currentYear) status = pickWeighted(rand, [['On lot', 4], ['In transit', 3.5], ['In production', 0.6]], (x) => x[1])[0];
      } else {
        const expectedMiles = (age + 0.4) * 12000;
        const mileAdj = 1 - ((miles - expectedMiles) / 10000) * 0.022;
        const optionsKept = optionsTotal * 0.35;
        price = (msrpBase * retained(m.dep, age + 0.6) + optionsKept) * mileAdj * regional * (1 + (rand() - 0.5) * 0.12);
        if (certified) price *= 1.035;
        price = Math.max(4500, price);
      }
      price = round(price, rand() < 0.5 ? 100 : 1) - (rand() < 0.4 ? 1 : 0);

      // Listing history: age on market and price changes.
      const daysListed = isNew && status !== 'On lot' ? Math.floor(rand() * 12) : Math.floor(Math.pow(rand(), 1.7) * 120);
      // Each entry is a price set on that day: the opening price, then each cut.
      const drops = daysListed > 10 ? Math.floor(rand() * Math.min(5, daysListed / 12 + 1)) : 0;
      const dropDays = new Set();
      for (let d = 0; d < drops; d++) dropDays.add(Math.max(1, Math.floor(daysListed * rand() * 0.95)));
      const cuts = [...dropDays].sort((a, b) => a - b); // most recent first
      const history = [];
      let p = price;
      for (const dd of cuts) {
        history.push({ daysAgo: dd, price: p });
        p = round(p * (1 + 0.008 + rand() * 0.028), 100) - 1;
      }
      history.push({ daysAgo: daysListed, price: p });
      history.reverse(); // oldest first

      const indie = !isNew && rand() < 0.35;
      const dealerName = indie
        ? `${INDIE_PREFIX[Math.floor(rand() * INDIE_PREFIX.length)]} ${INDEPENDENTS[Math.floor(rand() * INDEPENDENTS.length)]}`
        : `${city[0]} ${m.make}`;
      const dealerId = `${dealerName}|${city[0]}|${city[1]}`;
      if (!dealers.has(dealerId)) {
        dealers.set(dealerId, { id: 'd' + dealers.size, name: dealerName, city: city[0], state: city[1], lat: city[2], lng: city[3], franchise: !indie });
      }
      const dealer = dealers.get(dealerId);

      const fuel = m.fuel[skewIndex(rand, m.fuel.length, 1.5)];
      listings.push({
        id: 'L' + String(i + 1).padStart(5, '0'),
        vin: makeVin(rand, m.wmi, year),
        year, make: m.make, model: m.model, trim,
        body: m.body, segment: m.seg,
        drivetrain: m.dt[Math.floor(rand() * m.dt.length)],
        fuel,
        condition, status,
        miles, price, msrp, msrpBase,
        options,
        extColor, extHex, intColor,
        dealerId: dealer.id, dealer: dealer.name, franchise: dealer.franchise,
        city: dealer.city, state: dealer.state, lat: dealer.lat, lng: dealer.lng,
        daysListed,
        history,
      });
    }
    return { listings, dealers: [...dealers.values()], models: MODELS, cities: CITIES };
  }

  const api = { generateInventory, mulberry32, MODELS, CITIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarketData = api;
})(typeof window !== 'undefined' ? window : globalThis);
