/**
 * ============================================================================
 * CITY ALIASES DATABASE — MERGED (oracle-v2 + multibot)
 * ============================================================================
 * Union of both repos' alias maps. Verified lossless: multibot was a strict
 * superset of oracle-v2 (zero conflicting mappings); the only oracle-v2-unique
 * key, "vijay nagar delhi" -> Delhi, is re-added below in the Delhi block.
 *
 * Covers the original 11 routed cities (Delhi, Gurgaon, Noida, Ambala, Patiala,
 * Chandigarh, Zirakpur, Mohali, Amritsar, Ludhiana, Jalandhar) PLUS ~49 extra
 * cities (NCR, Rajasthan, Uttarakhand, Himachal). Extra cities are harmless for
 * routing — extractPickupCity only matches against each bot's configuredCities,
 * so non-configured cities resolve to "no city" and are simply ignored.
 *
 * To adopt: point core/filter.js's import at this file, or replace
 * core/cityAliases.js with it, in whichever bots should share the full map.
 *
 * QUOTE RULES:
 * - No quotes: Single-word keys (ambala, delhi, mohali)
 * - Quotes required: Keys with spaces, numbers, or special chars ("sector 17", "t1")
 * ============================================================================
 */

export const CITY_ALIASES = {
  // ============================================================================
  // AMBALA
  // ============================================================================
  amb: "Ambala",
  ambl: "Ambala",
  ambala: "Ambala",
  "ambala cantt": "Ambala",
  "ambala cantonment": "Ambala",
  "ambala city": "Ambala",
  "ambala railway station": "Ambala",

  // ============================================================================
  // PATIALA
  // ============================================================================
  pti: "Patiala",
  ptl: "Patiala",
  patiala: "Patiala",
  patiyala: "Patiala",
  pattiala: "Patiala",
  nabha: "Patiala",
  rajpura: "Patiala",
  samana: "Patiala",
  sirhind: "Patiala",

  // ============================================================================
  // CHANDIGARH (Tricity Hub)
  // ============================================================================
  chd: "Chandigarh",
  chandi: "Chandigarh",
  chandigarh: "Chandigarh",
  chandhigarh: "Chandigarh",
  chandigrah: "Chandigarh",        // Intentional typo
  chandiarh: "Chandigarh",         // Intentional typo
  chandigad: "Chandigarh",         // Intentional typo
  "chandigarh airport": "Chandigarh",
  "chandigarh sector": "Chandigarh",
  "isbt 17": "Chandigarh",
  "isbt 43": "Chandigarh",
  "isbt chandigarh": "Chandigarh",
  "sector 17": "Chandigarh",
  "sector 35": "Chandigarh",
  "43 bus stand": "Chandigarh",
  "43 isbt": "Chandigarh",
  "bus stand 43": "Chandigarh",
  "chandigarh 43": "Chandigarh",
  panchkula: "Chandigarh",
  panchkoola: "Chandigarh",        // Intentional typo
  pgi: "Chandigarh",
  pgimer: "Chandigarh",
  pkl: "Chandigarh",

  // ============================================================================
  // ZIRAKPUR
  // ============================================================================
  zkp: "Zirakpur",
  zirakpur: "Zirakpur",
  zirkapur: "Zirakpur",
  zirkpur: "Zirakpur",
  jerkpur: "Zirakpur",             // Intentional typo
  zirapur: "Zirakpur",             // Intentional typo
  "dera bassi": "Zirakpur",
  "dera basi": "Zirakpur",
  derabassi: "Zirakpur",
  dhakoli: "Zirakpur",
  dhakauli: "Zirakpur",            // Intentional typo

  // ============================================================================
  // MOHALI
  // ============================================================================
  mhl: "Mohali",
  mohali: "Mohali",
  mohli: "Mohali",                 // Intentional typo
  mohaali: "Mohali",               // Intentional typo
  moali: "Mohali",                 // Intentional typo
  "mohali airport": "Mohali",
  "mohali phase": "Mohali",
  "mohali sector": "Mohali",
  "phase 10": "Mohali",
  "phase 11": "Mohali",
  "sahibzada ajit singh nagar": "Mohali",
  "sas nagar": "Mohali",
  kharar: "Mohali",
  khrar: "Mohali",
  kharad: "Mohali",
  kahrar: "Mohali",
  kurali: "Mohali",
  landran: "Mohali",
  morinda: "Mohali",

  // ============================================================================
  // AMRITSAR
  // ============================================================================
  asr: "Amritsar",
  amritsar: "Amritsar",
  amritser: "Amritsar",
  amritsarr: "Amritsar",
  amritsir: "Amritsar",            // Intentional typo
  amritar: "Amritsar",             // Intentional typo
  "amritsar airport": "Amritsar",
  "golden temple": "Amritsar",
  "wagah border": "Amritsar",
  abohar: "Amritsar",
  beas: "Amritsar",

  // ============================================================================
  // LUDHIANA
  // ============================================================================
  ldh: "Ludhiana",
  ludhiana: "Ludhiana",
  ludhiyana: "Ludhiana",
  ludhianaa: "Ludhiana",
  ludiana: "Ludhiana",             // Intentional typo
  ludhianna: "Ludhiana",           // Intentional typo
  khanna: "Ludhiana",

  // ============================================================================
  // JALANDHAR
  // ============================================================================
  jld: "Jalandhar",
  jalandhar: "Jalandhar",
  jalandar: "Jalandhar",
  jullundur: "Jalandhar",
  jalandarh: "Jalandhar",          // Intentional typo
  phagwara: "Jalandhar",

  // ============================================================================
  // DELHI (NCR Capital)
  // ============================================================================
  dli: "Delhi",
  delhi: "Delhi",
  dehli: "Delhi",
  dilli: "Delhi",
  dilhi: "Delhi",
  dilhe: "Delhi",
  delhy: "Delhi",                  // Intentional typo
  "new delhi": "Delhi",
  "delhi airport": "Delhi",
  "delhi junction": "Delhi",
  "delhi railway": "Delhi",
  igi: "Delhi",
  "igi airport": "Delhi",
  "indira gandhi airport": "Delhi",
  t1: "Delhi",
  t2: "Delhi",
  t3: "Delhi",
  "terminal 1": "Delhi",
  "terminal 2": "Delhi",
  "terminal 3": "Delhi",
  "terminal one": "Delhi",
  "terminal two": "Delhi",
  "terminal three": "Delhi",
  terminal1: "Delhi",
  terminal2: "Delhi",
  terminal3: "Delhi",
  aerocity: "Delhi",
  "connaught place": "Delhi",
  cp: "Delhi",
  dwarka: "Delhi",
  "dwarka sector": "Delhi",
  "kashmere gate": "Delhi",
  "kashmiri gate": "Delhi",
  "kashmir gate": "Delhi",
  "kashmeri gate": "Delhi",
  "isbt delhi": "Delhi",
  "anand vihar": "Delhi",
  "anand vihar isbt": "Delhi",
  "anand vihar terminal": "Delhi",
  "sarai kale khan": "Delhi",
  "sarai kale khan isbt": "Delhi",
  nizamuddin: "Delhi",
  "hazrat nizamuddin": "Delhi",
  "nizamuddin railway": "Delhi",
  "new delhi railway": "Delhi",
  "new delhi station": "Delhi",
  "old delhi": "Delhi",
  "old delhi railway": "Delhi",
  "old delhi station": "Delhi",
  ndls: "Delhi",
  "ajmeri gate": "Delhi",
  "ajmeri gate railway": "Delhi",
  "ajmeri gate railway station": "Delhi",
  "sarai rohilla": "Delhi",
  "karol bagh": "Delhi",
  paharganj: "Delhi",
  "chandni chowk": "Delhi",
  "india gate": "Delhi",
  "red fort": "Delhi",
  rohini: "Delhi",
  pitampura: "Delhi",
  "model town": "Delhi",
  "civil lines": "Delhi",
  shahdara: "Delhi",
  "dilshad garden": "Delhi",
  "preet vihar": "Delhi",
  "mayur vihar": "Delhi",
  kalkaji: "Delhi",
  "nehru place": "Delhi",
  "greater kailash": "Delhi",
  gk: "Delhi",
  "gk 1": "Delhi",
  "gk 2": "Delhi",
  "defence colony": "Delhi",
  saket: "Delhi",
  "saket metro": "Delhi",
  "hauz khas": "Delhi",
  "green park": "Delhi",
  "malviya nagar": "Delhi",
  "lajpat nagar": "Delhi",
  "south delhi": "Delhi",
  "east delhi": "Delhi",
  "west delhi": "Delhi",
  "north delhi": "Delhi",
  "central delhi": "Delhi",
  janakpuri: "Delhi",
  "rajouri garden": "Delhi",
  "punjabi bagh": "Delhi",
  "paschim vihar": "Delhi",
  "kirti nagar": "Delhi",
  "moti nagar": "Delhi",
  "tilak nagar": "Delhi",
  "subhash nagar": "Delhi",
  "uttam nagar": "Delhi",
  "lakshmi nagar": "Delhi",
  "gtb nagar": "Delhi",
  "vijay nagar": "Delhi",
  "vijay nagar delhi": "Delhi",
  "shalimar bagh": "Delhi",
  "vasant vihar": "Delhi",
  "vasant kunj": "Delhi",
  "r k puram": "Delhi",
  munirka: "Delhi",
  mahipalpur: "Delhi",
  "vivek vihar": "Delhi",
  "rajiv chowk": "Delhi",
  "rajiv chowk metro": "Delhi",
  sadar: "Delhi",
  "sadar bazar": "Delhi",
  okhla: "Delhi",

  // ============================================================================
  // NOIDA
  // ============================================================================
  noida: "Noida",
  nioda: "Noida",                  // Intentional typo
  noyda: "Noida",                  // Intentional typo
  noeda: "Noida",                  // Intentional typo
  "greater noida": "Noida",
  "gr noida": "Noida",
  "greater noida west": "Noida",
  "noida extension": "Noida",
  "noida sector": "Noida",
  "noida city": "Noida",
  "noida city centre": "Noida",
  "sector 15": "Noida",
  "sector 16": "Noida",
  "sector 18": "Noida",
  "sector 52": "Noida",
  "sector 58": "Noida",
  "sector 59": "Noida",
  "sector 61": "Noida",
  "sector 62": "Noida",
  "sector 63": "Noida",
  "sector 125": "Noida",
  "sector 137": "Noida",
  "botanical garden": "Noida",
  "film city": "Noida",
  alpha: "Noida",
  beta: "Noida",
  gamma: "Noida",
  delta: "Noida",
  "knowledge park": "Noida",
  "pari chowk": "Noida",
  jewar: "Noida",
  "jewar airport": "Noida",

  // ============================================================================
  // GURGAON / GURUGRAM
  // ============================================================================
  ggn: "Gurgaon",
  grg: "Gurgaon",
  gurgaon: "Gurgaon",
  gurgoan: "Gurgaon",
  gurugram: "Gurgaon",
  gurgao: "Gurgaon",               // Intentional typo
  guragon: "Gurgaon",              // Intentional typo
  "cyber city": "Gurgaon",
  "cyber hub": "Gurgaon",
  "dlf cyber city": "Gurgaon",
  "golf course road": "Gurgaon",
  "golf course extension": "Gurgaon",
  "mg road": "Gurgaon",
  "mg road gurgaon": "Gurgaon",
  "mg road metro": "Gurgaon",
  "huda city centre": "Gurgaon",
  "iffco chowk": "Gurgaon",
  "sushant lok": "Gurgaon",
  "dlf phase": "Gurgaon",
  "dlf phase 1": "Gurgaon",
  "dlf phase 2": "Gurgaon",
  "dlf phase 3": "Gurgaon",
  "dlf phase 4": "Gurgaon",
  "dlf phase 5": "Gurgaon",
  "dlf 1": "Gurgaon",
  "dlf 2": "Gurgaon",
  "dlf 3": "Gurgaon",
  "dlf 4": "Gurgaon",
  "dlf 5": "Gurgaon",
  "sector 29": "Gurgaon",
  "south city": "Gurgaon",
  "palam vihar": "Gurgaon",
  "udyog vihar": "Gurgaon",
  sohna: "Gurgaon",
  "sohna road": "Gurgaon",
  manesar: "Gurgaon",
  "new gurgaon": "Gurgaon",
  "old gurgaon": "Gurgaon",

  // ============================================================================
  // FARIDABAD
  // ============================================================================
  fbd: "Faridabad",
  faridabad: "Faridabad",
  faridabaad: "Faridabad",
  fariadabad: "Faridabad",
  fridabad: "Faridabad",           // Intentional typo
  faridbaad: "Faridabad",          // Intentional typo
  "new faridabad": "Faridabad",
  "old faridabad": "Faridabad",
  badarpur: "Faridabad",
  "badarpur border": "Faridabad",
  ballabgarh: "Faridabad",
  "bata chowk": "Faridabad",
  "neelam chowk": "Faridabad",
  "nhpc chowk": "Faridabad",
  "sector 16 faridabad": "Faridabad",

  // ============================================================================
  // GHAZIABAD
  // ============================================================================
  ghz: "Ghaziabad",
  gzb: "Ghaziabad",
  ghaziabad: "Ghaziabad",
  gaziabad: "Ghaziabad",
  ghazibaad: "Ghaziabad",          // Intentional typo
  gaziabaad: "Ghaziabad",          // Intentional typo
  indirapuram: "Ghaziabad",
  vaishali: "Ghaziabad",
  kaushambi: "Ghaziabad",
  vasundhara: "Ghaziabad",
  "mohan nagar": "Ghaziabad",
  "raj nagar": "Ghaziabad",
  "raj nagar extension": "Ghaziabad",
  "vijay nagar": "Ghaziabad",
  "crossings republik": "Ghaziabad",
  loni: "Ghaziabad",
  "loni border": "Ghaziabad",
  "old ghaziabad": "Ghaziabad",

  // ============================================================================
  // BATHINDA
  // ============================================================================
  bti: "Bathinda",
  bathinda: "Bathinda",
  bhatinda: "Bathinda",            // Intentional typo
  batinda: "Bathinda",             // Intentional typo

  // ============================================================================
  // KOTKAPURA & FARIDKOT (Corrected from kotakpura)
  // ============================================================================
  kotkapura: "Kotkapura",
  kotakpura: "Kotkapura",          // Intentional typo (was wrongly in original)
  faridkot: "Kotkapura",
  faridkote: "Kotkapura",          // Intentional typo
  feridkot: "Kotkapura",           // Intentional typo

  // ============================================================================
  // MALERKOTLA
  // ============================================================================
  malerkotla: "Malerkotla",
  malerkatla: "Malerkotla",        // Intentional typo
  malerkotala: "Malerkotla",       // Intentional typo

  // ============================================================================
  // KARNAL
  // ============================================================================
  karnal: "Karnal",
  karanal: "Karnal",               // Intentional typo
  kernal: "Karnal",                // Intentional typo

  // ============================================================================
  // PANIPAT
  // ============================================================================
  panipat: "Panipat",
  panipaat: "Panipat",             // Intentional typo
  paneepat: "Panipat",             // Intentional typo

  // ============================================================================
  // ROHTAK
  // ============================================================================
  rohtak: "Rohtak",
  rohtak: "Rohtak",
  rohtaak: "Rohtak",               // Intentional typo

  // ============================================================================
  // HISAR
  // ============================================================================
  hisar: "Hisar",
  hissar: "Hisar",
  hesar: "Hisar",                  // Intentional typo

  // ============================================================================
  // PATHANKOT
  // ============================================================================
  pathankot: "Pathankot",
  pathankote: "Pathankot",         // Intentional typo
  pathankott: "Pathankot",         // Intentional typo

  // ============================================================================
  // AGRA
  // ============================================================================
  agra: "Agra",
  aagra: "Agra",                   // Intentional typo
  "taj mahal": "Agra",
  mathura: "Agra",
  mathuara: "Agra",                // Intentional typo

  // ============================================================================
  // JAIPUR
  // ============================================================================
  jpr: "Jaipur",
  jaipur: "Jaipur",
  jaipure: "Jaipur",               // Intentional typo
  jypur: "Jaipur",                 // Intentional typo
  "pink city": "Jaipur",

  // ============================================================================
  // JODHPUR
  // ============================================================================
  jodhpur: "Jodhpur",
  jodhpure: "Jodhpur",             // Intentional typo
  jodhpurr: "Jodhpur",             // Intentional typo

  // ============================================================================
  // AJMER
  // ============================================================================
  ajmer: "Ajmer",
  ajmere: "Ajmer",                 // Intentional typo
  ajmeer: "Ajmer",                 // Intentional typo
  pushkar: "Ajmer",
  pushker: "Ajmer",                // Intentional typo

  // ============================================================================
  // UDAIPUR
  // ============================================================================
  udaipur: "Udaipur",
  udaipure: "Udaipur",             // Intentional typo
  udaypur: "Udaipur",              // Intentional typo

  // ============================================================================
  // UTTARAKHAND CITIES (Enhanced)
  // ============================================================================
  
  // DEHRADUN (Capital)
  dehradun: "Dehradun",
  dehradoon: "Dehradun",           // Intentional typo
  dehraddun: "Dehradun",           // Intentional typo
  dehraduun: "Dehradun",           // Intentional typo
  ddn: "Dehradun",
  "dehradun airport": "Dehradun",
  "jolly grant": "Dehradun",
  "jolly grant airport": "Dehradun",
  mussoorie: "Dehradun",
  mussorie: "Dehradun",            // Intentional typo
  musoorie: "Dehradun",            // Intentional typo
  "clock tower dehradun": "Dehradun",
  "rajpur road": "Dehradun",
  clement: "Dehradun",
  "clement town": "Dehradun",
  saharanpur: "Dehradun",
  saharnpur: "Dehradun",           // Intentional typo

  // HARIDWAR (Pilgrimage Hub)
  haridwar: "Haridwar",
  hardwar: "Haridwar",
  hariwar: "Haridwar",             // Intentional typo
  haridwaar: "Haridwar",           // Intentional typo
  "har ki pauri": "Haridwar",
  "har ki paudi": "Haridwar",      // Intentional typo
  rishikesh: "Haridwar",
  rishikesh: "Haridwar",
  rishikesh: "Haridwar",
  risikesh: "Haridwar",            // Intentional typo
  rishikes: "Haridwar",            // Intentional typo
  "laxman jhula": "Haridwar",
  "lakshman jhula": "Haridwar",
  "ram jhula": "Haridwar",
  "triveni ghat": "Haridwar",

  // NAINITAL (Lake City)
  nainital: "Nainital",
  nanital: "Nainital",             // Intentional typo
  naintal: "Nainital",             // Intentional typo
  nanitaal: "Nainital",            // Intentional typo
  "nainital lake": "Nainital",
  "naini lake": "Nainital",
  "naina devi": "Nainital",
  bhimtal: "Nainital",
  bhimtaal: "Nainital",            // Intentional typo
  "sat tal": "Nainital",
  sattal: "Nainital",
  haldwani: "Nainital",
  haldwani: "Nainital",
  haldvani: "Nainital",            // Intentional typo
  kathgodam: "Nainital",
  kathgodaam: "Nainital",          // Intentional typo

  // MUSSOORIE (Queen of Hills)
  "mall road mussoorie": "Mussoorie",
  "kempty falls": "Mussoorie",
  "kempty fall": "Mussoorie",
  landour: "Mussoorie",
  landaur: "Mussoorie",            // Intentional typo

  // ALMORA
  almora: "Almora",
  almoda: "Almora",                // Intentional typo
  almoraa: "Almora",               // Intentional typo
  ranikhet: "Almora",
  ranikhet: "Almora",
  ranekhet: "Almora",              // Intentional typo

  // JIM CORBETT (Wildlife)
  corbett: "Corbett",
  "jim corbett": "Corbett",
  "corbett national park": "Corbett",
  "jim corbett park": "Corbett",
  ramnagar: "Corbett",
  ramnaagar: "Corbett",            // Intentional typo

  // PAURI GARHWAL
  pauri: "Pauri",
  paudi: "Pauri",                  // Intentional typo
  "pauri garhwal": "Pauri",

  // RUDRAPRAYAG & KEDARNATH
  rudraprayag: "Rudraprayag",
  rudraprayaag: "Rudraprayag",     // Intentional typo
  rudrapryag: "Rudraprayag",       // Intentional typo
  kedarnath: "Rudraprayag",
  kedarnath: "Rudraprayag",
  kedarnaath: "Rudraprayag",       // Intentional typo
  kedrarnath: "Rudraprayag",       // Intentional typo
  gaurikund: "Rudraprayag",
  gowrikund: "Rudraprayag",        // Intentional typo

  // BADRINATH & CHAMOLI
  badrinath: "Badrinath",
  badrinaath: "Badrinath",         // Intentional typo
  badrinath: "Badrinath",
  badreenaath: "Badrinath",        // Intentional typo
  chamoli: "Badrinath",
  chamolee: "Badrinath",           // Intentional typo
  joshimath: "Badrinath",
  joshimaath: "Badrinath",         // Intentional typo
  auli: "Badrinath",
  aulee: "Badrinath",              // Intentional typo
  "auli skiing": "Badrinath",

  // YAMUNOTRI & GANGOTRI
  yamunotri: "Yamunotri",
  yamunotree: "Yamunotri",         // Intentional typo
  yamnotri: "Yamunotri",           // Intentional typo
  gangotri: "Gangotri",
  gangotree: "Gangotri",           // Intentional typo
  gangotry: "Gangotri",            // Intentional typo
  uttarkashi: "Gangotri",
  uttarkashi: "Gangotri",
  uttarkasi: "Gangotri",           // Intentional typo

  // TEHRI
  tehri: "Tehri",
  tehree: "Tehri",                 // Intentional typo
  "tehri dam": "Tehri",
  "new tehri": "Tehri",

  // PITHORAGARH
  pithoragarh: "Pithoragarh",
  pithoragad: "Pithoragarh",       // Intentional typo
  pithoragaarh: "Pithoragarh",     // Intentional typo

  // BAGESHWAR
  bageshwar: "Bageshwar",
  bagheswar: "Bageshwar",          // Intentional typo
  bageswar: "Bageshwar",           // Intentional typo

  // CHAMPAWAT
  champawat: "Champawat",
  champavat: "Champawat",          // Intentional typo
  champawaat: "Champawat",         // Intentional typo

  // UDHAM SINGH NAGAR
  rudrapur: "Rudrapur",
  rudrapure: "Rudrapur",           // Intentional typo
  rudrapuur: "Rudrapur",           // Intentional typo
  kashipur: "Rudrapur",
  kashipure: "Rudrapur",           // Intentional typo
  kichha: "Rudrapur",
  kiccha: "Rudrapur",              // Intentional typo

  // ============================================================================
  // HIMACHAL PRADESH CITIES (Enhanced)
  // ============================================================================

  // SHIMLA (Capital - Queen of Hills)
  shimla: "Shimla",
  simla: "Shimla",
  shimlaa: "Shimla",               // Intentional typo
  shimlah: "Shimla",               // Intentional typo
  shmla: "Shimla",                 // Intentional typo
  "shimla airport": "Shimla",
  "mall road shimla": "Shimla",
  kufri: "Shimla",
  kuffri: "Shimla",                // Intentional typo
  kufree: "Shimla",                // Intentional typo
  chail: "Shimla",
  chayl: "Shimla",                 // Intentional typo
  "the ridge": "Shimla",
  jakhu: "Shimla",
  "jakhu temple": "Shimla",
  naldehra: "Shimla",
  naldehara: "Shimla",             // Intentional typo

  // MANALI (Adventure Capital)
  manali: "Manali",
  manaali: "Manali",               // Intentional typo
  manalli: "Manali",               // Intentional typo
  manal: "Manali",                 // Intentional typo
  "manali airport": "Manali",
  "bhuntar airport": "Manali",
  kullu: "Manali",
  kulloo: "Manali",                // Intentional typo
  kulu: "Manali",                  // Intentional typo
  "kullu manali": "Manali",
  rohtang: "Manali",
  "rohtang pass": "Manali",
  "rohtang la": "Manali",
  rothang: "Manali",               // Intentional typo
  solang: "Manali",
  "solang valley": "Manali",
  "solang nala": "Manali",
  sollang: "Manali",               // Intentional typo
  "old manali": "Manali",
  "mall road manali": "Manali",
  vashisht: "Manali",
  vashisth: "Manali",
  vasisth: "Manali",               // Intentional typo
  naggar: "Manali",
  nagar: "Manali",
  naggr: "Manali",                 // Intentional typo
  "naggar castle": "Manali",

  // DHARAMSHALA & MCLEODGANJ (Dalai Lama's Residence)
  dharamshala: "Dharamshala",
  dharamsala: "Dharamshala",
  dharamshala: "Dharamshala",
  dharmshala: "Dharamshala",       // Intentional typo
  dhramshala: "Dharamshala",       // Intentional typo
  dharmsala: "Dharamshala",        // Intentional typo
  "dharamshala airport": "Dharamshala",
  "gaggal airport": "Dharamshala",
  mcleodganj: "Dharamshala",
  "mcleod ganj": "Dharamshala",
  mcleodgunj: "Dharamshala",       // Intentional typo
  mcleodgng: "Dharamshala",        // Intentional typo
  mcleod: "Dharamshala",
  "dal lake dharamshala": "Dharamshala",
  "bhagsu waterfall": "Dharamshala",
  bhagsu: "Dharamshala",
  bhagsunag: "Dharamshala",
  triund: "Dharamshala",
  triyund: "Dharamshala",          // Intentional typo
  kangra: "Dharamshala",
  kangra: "Dharamshala",
  kangara: "Dharamshala",          // Intentional typo
  palampur: "Dharamshala",
  palampure: "Dharamshala",        // Intentional typo

  // DALHOUSIE
  dalhousie: "Dalhousie",
  dalhosie: "Dalhousie",           // Intentional typo
  dalhousee: "Dalhousie",          // Intentional typo
  dalhausie: "Dalhousie",          // Intentional typo
  khajjiar: "Dalhousie",
  khajjar: "Dalhousie",            // Intentional typo
  khajiar: "Dalhousie",            // Intentional typo
  "mini switzerland": "Dalhousie",
  chamba: "Dalhousie",
  chamba: "Dalhousie",
  chamba: "Dalhousie",             

  // KASAULI
  kasauli: "Kasauli",
  kasaulee: "Kasauli",             // Intentional typo
  kasoli: "Kasauli",               // Intentional typo
  kasauli: "Kasauli",

  // SOLAN (Mushroom City)
  solan: "Solan",
  solaan: "Solan",                 // Intentional typo
  solen: "Solan",                  // Intentional typo
  "mushroom city": "Solan",

  // MANDI
  mandi: "Mandi",
  mandee: "Mandi",                 // Intentional typo
  mandhi: "Mandi",                 // Intentional typo

  // UNA
  una: "Una",
  unna: "Una",                     // Intentional typo

  // HAMIRPUR
  hamirpur: "Hamirpur",
  hamipur: "Hamirpur",             // Intentional typo
  hamirpure: "Hamirpur",           // Intentional typo

  // BILASPUR
  bilaspur: "Bilaspur",
  bilaspur: "Bilaspur",
  bilaspure: "Bilaspur",           // Intentional typo

  // KINNAUR & SPITI
  kinnaur: "Kinnaur",
  kinnor: "Kinnaur",               // Intentional typo
  kinnauar: "Kinnaur",             // Intentional typo
  spiti: "Spiti",
  spity: "Spiti",                  // Intentional typo
  spitti: "Spiti",                 // Intentional typo
  "spiti valley": "Spiti",
  kaza: "Spiti",
  kaaza: "Spiti",                  // Intentional typo
  tabo: "Spiti",
  taabo: "Spiti",                  // Intentional typo
  "key monastery": "Spiti",
  "ki monastery": "Spiti",

  // LAHAUL
  lahaul: "Lahaul",
  lahual: "Lahaul",                // Intentional typo
  lahul: "Lahaul",                 // Intentional typo
  "lahaul spiti": "Lahaul",
  keylong: "Lahaul",
  kyelong: "Lahaul",               // Intentional typo

  // SIRMAUR
  sirmaur: "Sirmaur",
  sirmour: "Sirmaur",              // Intentional typo
  sirmaour: "Sirmaur",             // Intentional typo
  nahan: "Sirmaur",
  nahaan: "Sirmaur",               // Intentional typo

  // PARWANOO
  parwanoo: "Parwanoo",
  parwanu: "Parwanoo",             // Intentional typo
  parvanu: "Parwanoo",             // Intentional typo

  // BAROG
  barog: "Barog",
  barog: "Barog",
  barog: "Barog",                  // Intentional typo

  // MASHOBRA
  mashobra: "Mashobra",
  mashobara: "Mashobra",           // Intentional typo
  mashobraa: "Mashobra",           // Intentional typo

  // RAMPUR BUSHAHR
  rampur: "Rampur Bushahr",
  "rampur bushahr": "Rampur Bushahr",
  rampure: "Rampur Bushahr",       // Intentional typo
};

/**
 * Get canonical city name from alias
 * @param {string} alias - City alias (e.g., "dli", "shimla airport")
 * @returns {string|null} - Canonical city name or null
 */
export function getCanonicalCityName(alias) {
  if (!alias) return null;
  const normalized = alias.toLowerCase().trim();
  return CITY_ALIASES[normalized] || null;
}

/**
 * Match word against configured cities
 * @param {string} word - Word to match
 * @param {string[]} configuredCities - List of configured city names
 * @returns {string|null} - Matched city or null
 */
export function matchCity(word, configuredCities) {
  if (!word || !configuredCities) return null;
  const canonical = getCanonicalCityName(word);
  if (canonical && configuredCities.includes(canonical)) {
    return canonical;
  }
  return null;
}

/**
 * Get all aliases for a canonical city name
 * @param {string} canonicalName - Canonical city name
 * @returns {string[]} - Array of aliases
 */
export function getAliasesForCity(canonicalName) {
  return Object.entries(CITY_ALIASES)
    .filter(([alias, canonical]) => canonical === canonicalName)
    .map(([alias]) => alias);
}