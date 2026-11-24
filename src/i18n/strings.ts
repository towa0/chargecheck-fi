export type Lang = 'fi' | 'en';

export interface Strings {
  appTitle: string;
  skip: string;
  nav: { language: string; region: string; nearMe: string; locating: string; home: string };
  regions: Record<string, string>;
  filters: {
    label: string;
    energy: string;
    start: string;
    connector: string;
    anyConnector: string;
    fastOnly: string;
    fastOnlyHint: string;
    energyToAdd: string;
    custom: string;
    customEnergy: string;
    energyError: (min: number, max: number) => string;
    startCharging: string;
    startTime: string;
    now: string;
    done: string;
  };
  time: { now: string; tonight: (hm: string) => string; tomorrow: (hm: string) => string; today: (hm: string) => string };
  hero: {
    label: string;
    action: string;
    showInList: string;
    chargeTime: (d: string) => string;
    cheaperFrom: (amount: string, when: string) => string;
    loading: string;
    noFree: (what: string) => string;
    noMatch: (what: string) => string;
    fastWord: string;
    noPrice: string;
    unavailable: string;
    useAnyConnector: string;
    turnOffFast: string;
    tomorrow: string;
  };
  list: {
    title: string;
    sort: string;
    sortCost: string;
    sortDistance: string;
    sortPower: string;
    showing: (shown: number, total: number) => string;
    found: (n: number, region: string) => string;
    more: (n: number) => string;
    distFromMe: string;
    distFromCentre: string;
    distFailed: string;
    loading: string;
  };
  card: {
    details: string;
    estimated: string;
    noPrice: string;
    cantEstimate: string;
    cantEstimateWhy: (reason: string) => string;
    free: string;
    freeShort: string;
    breakdown: string;
    item: string;
    amountPrice: string;
    cost: string;
    priceN: (n: number) => string;
    at: string;
    place: string;
    chargePoints: string;
    noAddress: string;
    open247: string;
    noHours: string;
    directions: string;
    directionsHint: string;
    openInMaps: string;
    whyRange: string;
    whyRangeBody: (n: number) => string;
    moreRefused: (n: number) => string;
    someNoPrice: string;
    disclaimer: string;
    vat: (pct: number) => string;
    outdated: string;
    ac: string;
    dc: string;
  };
  status: {
    free: string;
    freeOf: (a: number, t: number) => string;
    busy: string;
    busyAll: (t: number) => string;
    down: string;
    downAll: string;
    unknown: string;
    checking: string;
    updated: (ago: string) => string;
    ago: { now: string; min: (n: number) => string; h: (n: number) => string; d: (n: number) => string };
    words: Record<string, string>;
    noLive: (n: number) => string;
  };
  lines: { ENERGY: string; TIME: string; PARKING_TIME: string; FLAT: string };
  tariffType: { adhoc: string; regular: string; profile: string };
  states: {
    loadError: string;
    statusError: string;
    emptyTitle: (region: string) => string;
    emptyBody: string;
    searchAll: string;
  };
  sheet: { handle: string; peek: string; half: string; full: string };
  map: { label: string; loading: string; cluster: (n: number) => string };
  footer: { estimates: string; built: string; notAffiliated: string; source: string };
  units: { perKWh: string; perHour: string };
}

const fi: Strings = {
  appTitle: 'ChargeCheck: vapaat latauspisteet ja mitä lataus maksaa',
  skip: 'Siirry tuloksiin',
  nav: { language: 'Kieli', region: 'Kaupunki', nearMe: 'Lähellä minua', locating: 'Haetaan…', home: 'ChargeCheck, etusivu' },
  regions: { oulu: 'Oulu', finland: 'Koko Suomi' },
  filters: {
    label: 'Suodattimet',
    energy: 'Energia',
    start: 'Aloitus',
    connector: 'Liitintyyppi',
    anyConnector: 'Kaikki liittimet',
    fastOnly: 'Pikalataus',
    fastOnlyHint: ' (vähintään 50 kW)',
    energyToAdd: 'Ladattava energia',
    custom: 'Oma',
    customEnergy: 'Ladattava energia (kWh)',
    energyError: (a, b) => `Anna luku väliltä ${a}–${b}.`,
    startCharging: 'Latauksen aloitus',
    startTime: 'Aloitusaika (Suomen aika)',
    now: 'Nyt',
    done: 'Valmis',
  },
  time: {
    now: 'Nyt',
    tonight: (hm) => `Tänä iltana ${hm}`,
    tomorrow: (hm) => `Huomenna ${hm}`,
    today: (hm) => `Tänään ${hm}`,
  },
  hero: {
    label: 'Halvin vapaana nyt',
    action: 'Navigoi',
    showInList: 'Näytä listassa',
    chargeTime: (d) => `Latausaika noin ${d}`,
    cheaperFrom: (a, w) => `${a} halvemmalla alkaen ${w}`,
    loading: 'Haetaan vapaita latauspisteitä',
    noFree: () => 'Ei vapaita latauspisteitä juuri nyt.',
    noMatch: () => 'Ei latauspisteitä näillä valinnoilla.',
    fastWord: 'pika',
    noPrice: 'Vapailla latauspisteillä ei ole hintaa avoimessa datassa.',
    unavailable: 'Reaaliaikaista saatavuutta ei saada nyt, joten vapaita ei voi näyttää. Hinnat näkyvät silti alla.',
    useAnyConnector: 'Kaikki liittimet',
    turnOffFast: 'Poista pikalatausrajaus',
    tomorrow: 'huomenna',
  },
  list: {
    title: 'Latauspisteet',
    sort: 'Järjestys',
    sortCost: 'Hinta',
    sortDistance: 'Etäisyys',
    sortPower: 'Teho',
    showing: (s, t) => `Näytetään ${s} / ${t}`,
    found: (n, r) => `${n} ${n === 1 ? 'latauspiste' : 'latauspistettä'}: ${r}.`,
    more: (n) => `Näytä lisää (${n})`,
    distFromMe: 'Etäisyys sijainnistasi',
    distFromCentre: 'Etäisyys Oulun keskustasta',
    distFailed: 'Sijaintia ei saatu. Etäisyys Oulun keskustasta.',
    loading: 'Ladataan latauspisteitä',
  },
  card: {
    details: 'Lisätiedot',
    estimated: 'arvio',
    noPrice: 'Hintaa ei avoimessa datassa',
    cantEstimate: 'Hintaa ei voi arvioida',
    cantEstimateWhy: (r) => `Hintaa ei voi arvioida: ${r}`,
    free: 'Ilmainen',
    freeShort: 'Ilm.',
    breakdown: 'Hinnan erittely',
    item: 'Erä',
    amountPrice: 'Määrä × hinta sis. ALV',
    cost: 'Hinta',
    priceN: (n) => `Hinta ${n}`,
    at: 'teholla',
    place: 'Sijainti',
    chargePoints: 'Latauspisteet',
    noAddress: 'Osoitetta ei avoimessa datassa',
    open247: 'Auki 24/7',
    noHours: 'Aukioloaikoja ei avoimessa datassa',
    directions: 'Reittiohje',
    directionsHint: ' (Google Maps, avautuu uuteen välilehteen)',
    openInMaps: 'Avaa karttasovelluksessa',
    whyRange: 'Miksi hintahaarukka?',
    whyRangeBody: (n) =>
      `Tällä latauspisteellä on ${n} hintaa lataukseesi, esimerkiksi eri liittimille, latausnopeuksille tai maksutavoille. Jokainen näkyy erittelyssä.`,
    moreRefused: (n) => (n === 1 ? 'Yhtä muuta hintaa' : `${n} muuta hintaa`),
    someNoPrice: 'Joillakin liittimillä ei ole hintaa avoimessa datassa.',
    disclaimer: 'Arvio perustuu julkaistuun hinnastoon. Sovelluksessa tai roamingissa hinta voi poiketa.',
    vat: (p) => `ALV ${p} %`,
    outdated: 'voi olla vanhentunut',
    ac: 'AC',
    dc: 'DC',
  },
  status: {
    free: 'Vapaana',
    freeOf: (a, t) => `${a}/${t} vapaana`,
    busy: 'Varattu',
    busyAll: (t) => `Kaikki ${t} varattu`,
    down: 'Ei käytössä',
    downAll: 'Ei käytössä',
    unknown: 'Tila ei tiedossa',
    checking: 'Haetaan tilaa',
    updated: (a) => `Tila päivitetty ${a}`,
    ago: { now: 'juuri nyt', min: (n) => `${n} min sitten`, h: (n) => `${n} h sitten`, d: (n) => `${n} pv sitten` },
    words: {
      AVAILABLE: 'vapaana',
      CHARGING: 'käytössä',
      BLOCKED: 'estetty',
      RESERVED: 'varattu',
      OUTOFORDER: 'rikki',
      INOPERATIVE: 'ei toimi',
      PLANNED: 'ei vielä avattu',
      REMOVED: 'poistettu',
      UNKNOWN: 'tila ei tiedossa',
    },
    noLive: (n) => `${n} ilman reaaliaikaista tilaa`,
  },
  lines: { ENERGY: 'Energia', TIME: 'Latausaika', PARKING_TIME: 'Pysäköinti', FLAT: 'Aloitusmaksu' },
  tariffType: { adhoc: 'maksu paikan päällä', regular: 'sovelluksella tai latauskortilla', profile: 'latausprofiililla' },
  states: {
    loadError: 'Latauspisteiden tietoja ei saatu ladattua. Päivitä sivu ja yritä uudelleen.',
    statusError: 'Reaaliaikaista saatavuutta ei saada juuri nyt. Yritetään uudelleen taustalla. Hinnat näkyvät silti.',
    emptyTitle: (r) => `Ei latauspisteitä näillä valinnoilla (${r})`,
    emptyBody: 'Kokeile löysentää rajauksia.',
    searchAll: 'Hae koko Suomesta',
  },
  sheet: { handle: 'Latauspistelista', peek: 'Pienennä lista', half: 'Näytä lista puoliksi', full: 'Laajenna lista' },
  map: {
    label: 'Kartta listan latauspisteistä. Lista sisältää samat tiedot.',
    loading: 'Ladataan karttaa',
    cluster: (n) => `${n} latauspistettä tässä. Lähennä napauttamalla.`,
  },
  footer: {
    estimates: 'Arviot perustuvat julkaistuihin hinnastoihin. Sovelluksessa tai roamingissa hinta voi poiketa.',
    built: 'Latauspistedata päivitetty',
    notAffiliated: 'Ei sidoksissa mihinkään operaattoriin.',
    source: 'Lähdekoodi',
  },
  units: { perKWh: '/ kWh', perHour: '/ h' },
};

const en: Strings = {
  appTitle: 'ChargeCheck Finland: free chargers and what they cost',
  skip: 'Skip to results',
  nav: { language: 'Language', region: 'City', nearMe: 'Near me', locating: 'Locating…', home: 'ChargeCheck, home' },
  regions: { oulu: 'Oulu', finland: 'Finland' },
  filters: {
    label: 'Filters',
    energy: 'Energy',
    start: 'Start',
    connector: 'Connector',
    anyConnector: 'Any connector',
    fastOnly: 'Fast only',
    fastOnlyHint: ' (50 kW or more)',
    energyToAdd: 'Energy to add',
    custom: 'Custom',
    customEnergy: 'Energy to add (kWh)',
    energyError: (a, b) => `Enter a number from ${a} to ${b}.`,
    startCharging: 'Start charging',
    startTime: 'Start time (Finnish time)',
    now: 'Now',
    done: 'Done',
  },
  time: {
    now: 'Now',
    tonight: (hm) => `Tonight ${hm}`,
    tomorrow: (hm) => `Tomorrow ${hm}`,
    today: (hm) => `Today ${hm}`,
  },
  hero: {
    label: 'Best right now',
    action: 'Navigate',
    showInList: 'Show in list',
    chargeTime: (d) => `Charging takes about ${d}`,
    cheaperFrom: (a, w) => `${a} cheaper from ${w}`,
    loading: 'Checking which chargers are free',
    noFree: (w) => `No free ${w}chargers match right now.`,
    noMatch: (w) => `No ${w}chargers match.`,
    fastWord: 'fast',
    noPrice: 'The free chargers that match have no price in the open data.',
    unavailable: "Live availability is unavailable right now, so I can't tell which chargers are free. Prices below still work.",
    useAnyConnector: 'Use any connector',
    turnOffFast: "Turn off 'Fast only'",
    tomorrow: 'tomorrow',
  },
  list: {
    title: 'Chargers',
    sort: 'Sort by',
    sortCost: 'Price',
    sortDistance: 'Distance',
    sortPower: 'Power',
    showing: (s, t) => `Showing ${s} of ${t}`,
    found: (n, r) => `${n} ${n === 1 ? 'charger' : 'chargers'} found in ${r}.`,
    more: (n) => `Show more (${n})`,
    distFromMe: 'Distances from your location',
    distFromCentre: 'Distances from Oulu city centre',
    distFailed: "Couldn't get your location. Distances are from Oulu city centre.",
    loading: 'Loading chargers',
  },
  card: {
    details: 'Details',
    estimated: 'estimated',
    noPrice: 'Price not in the open data',
    cantEstimate: "Can't estimate",
    cantEstimateWhy: (r) => `Can't estimate: ${r}`,
    free: 'Free',
    freeShort: 'Free',
    breakdown: 'Cost breakdown',
    item: 'Item',
    amountPrice: 'Amount × price incl. VAT',
    cost: 'Cost',
    priceN: (n) => `Price ${n}`,
    at: 'at',
    place: 'Place',
    chargePoints: 'Charge points',
    noAddress: 'Address not in the open data',
    open247: 'Open 24/7',
    noHours: 'Opening hours not in the open data',
    directions: 'Directions',
    directionsHint: ' (Google Maps, opens in a new tab)',
    openInMaps: 'Open in maps app',
    whyRange: 'Why a range?',
    whyRangeBody: (n) =>
      `This charger lists ${n} prices for your session, for example for different connectors, charging speeds or ways to pay. Each one is in the breakdown below.`,
    moreRefused: (n) => (n === 1 ? 'One more price here' : `${n} more prices here`),
    someNoPrice: 'Some connectors here have no price in the open data.',
    disclaimer: 'Estimated from the published tariff. Prices in apps or via roaming can differ.',
    vat: (p) => `VAT ${p}%`,
    outdated: 'may be outdated',
    ac: 'AC',
    dc: 'DC',
  },
  status: {
    free: 'Free',
    freeOf: (a, t) => `${a} of ${t} free`,
    busy: 'In use',
    busyAll: (t) => `All ${t} in use`,
    down: 'Out of order',
    downAll: 'None working',
    unknown: 'No live status',
    checking: 'Checking status',
    updated: (a) => `status ${a}`,
    ago: { now: 'just now', min: (n) => `${n} min ago`, h: (n) => `${n} h ago`, d: (n) => `${n} days ago` },
    words: {
      AVAILABLE: 'free',
      CHARGING: 'in use',
      BLOCKED: 'blocked',
      RESERVED: 'reserved',
      OUTOFORDER: 'out of order',
      INOPERATIVE: 'not working',
      PLANNED: 'not open yet',
      REMOVED: 'removed',
      UNKNOWN: 'status unknown',
    },
    noLive: (n) => `${n} with no live status`,
  },
  lines: { ENERGY: 'Energy', TIME: 'Charging time', PARKING_TIME: 'Parking time', FLAT: 'Session fee' },
  tariffType: { adhoc: 'pay at the charger', regular: 'with an app or charging card', profile: 'with a charging profile' },
  states: {
    loadError: 'The charger data could not be loaded. Try reloading the page.',
    statusError: 'Live availability unavailable. Retrying in the background. Prices are still shown.',
    emptyTitle: (r) => `Nothing matches these filters in ${r}.`,
    emptyBody: 'Try loosening a filter.',
    searchAll: 'Search all of Finland',
  },
  sheet: { handle: 'Charger list', peek: 'Collapse list', half: 'Show list at half height', full: 'Expand list' },
  map: {
    label: 'Map of the chargers in the list. The list has the same information.',
    loading: 'Loading map',
    cluster: (n) => `${n} chargers here. Click to zoom in.`,
  },
  footer: {
    estimates: 'Estimates from published tariffs. Prices in apps or via roaming can differ.',
    built: 'Charger data built',
    notAffiliated: 'Not affiliated with any operator.',
    source: 'Source code',
  },
  units: { perKWh: '/ kWh', perHour: '/ h' },
};

export const STRINGS: Record<Lang, Strings> = { fi, en };
