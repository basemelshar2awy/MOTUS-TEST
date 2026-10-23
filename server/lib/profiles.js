'use strict';
/* Activity profiles: what each activity looks like inside MOTUS. The single source for the server
   (validation, revenue accounts, starting places) and the browser (labels, fields, lists; sent
   in the snapshot). The shared core — vehicles, drivers, maintenance, fuel, stock, finance,
   tracking, contracts, users — is the same for every activity.

   MOTUS never holds the end customer's personal data (students, employees, line passengers,
   consignees): it works with the line, the trip, the count and the revenue. Those people live
   in the Sabeel module (or outside system) that sells to them. Tourism keeps its passenger
   manifest: it is the company's own work with the agency (permits, roads). */

const T = (ar, en) => ({ ar, en });

const PROFILES = {
  tourism: {
    unit: T('حجز', 'Booking'), units: T('الحجوزات', 'Bookings'),
    intro: T('حجز مستقل (استقبال مطار، جولة، تأجير) أو جزء من برنامج سياحي.', 'A standalone booking (airport transfer, tour, hire) or part of a tour program.'),
    tripTypes: { airport: T('استقبال / توصيل مطار', 'Airport transfer'), city: T('جولة داخلية', 'City tour'), intercity: T('رحلة بين المدن', 'Intercity trip'), hire: T('تأجير خاص', 'Private hire') },
    defaultTripType: 'airport',
    load: { kind: 'pax', label: T('عدد الركاب', 'Passengers'), short: T('ركاب', 'pax') },
    fields: ['flight'],
    manifest: true, lines: false, shipment: false, programs: true,
    placeKinds: ['city', 'airport', 'site', 'hotel'],
    clientTypes: ['agency', 'hotel', 'company', 'individual'],
    revenue: { airport: 'revenue_airport', city: 'revenue_city', intercity: 'revenue_intercity', hire: 'revenue_hire' },
  },
  education: {
    unit: T('رحلة مطلوبة', 'Trip request'), units: T('الحجوزات', 'Bookings'),
    intro: T('رحلات المدارس والجامعات اليومية بتتعمل من "الخطوط". هنا الرحلات الإضافية (رحلة مدرسية، يوم نشاط).', 'Daily school and university runs come from "Lines". Here are the extra trips (school trip, activity day).'),
    tripTypes: { school_go: T('ذهاب', 'Morning run'), school_return: T('عودة', 'Return run'), school_trip: T('رحلة مدرسية', 'School trip') },
    defaultTripType: 'school_trip',
    load: { kind: 'pax', label: T('عدد الطلاب', 'Students'), short: T('طالب', 'students') },
    fields: [], manifest: false, lines: true, shipment: false, programs: false,
    lineLegs: { go: 'school_go', return: 'school_return' }, legNames: { go: T('ذهاب', 'Morning'), return: T('عودة', 'Return') },
    placeKinds: ['city', 'school', 'station'],
    clientTypes: ['school', 'university'],
    revenue: { school_go: 'revenue_education', school_return: 'revenue_education', school_trip: 'revenue_education' },
  },
  staff: {
    unit: T('رحلة مطلوبة', 'Trip request'), units: T('الحجوزات', 'Bookings'),
    intro: T('رحلات الورديات اليومية بتتعمل من "الخطوط". هنا الرحلات الاستثنائية.', 'Daily shift runs come from "Lines". Here are the one-off trips.'),
    tripTypes: { shift_in: T('دخول وردية', 'Shift start'), shift_out: T('خروج وردية', 'Shift end'), staff_extra: T('رحلة استثنائية', 'One-off trip') },
    defaultTripType: 'staff_extra',
    load: { kind: 'pax', label: T('عدد الموظفين', 'Employees'), short: T('موظف', 'staff') },
    fields: [], manifest: false, lines: true, shipment: false, programs: false,
    lineLegs: { go: 'shift_in', return: 'shift_out' }, legNames: { go: T('دخول', 'Shift start'), return: T('خروج', 'Shift end') },
    placeKinds: ['city', 'office', 'pickup'],
    clientTypes: ['company', 'factory'],
    revenue: { shift_in: 'revenue_staff', shift_out: 'revenue_staff', staff_extra: 'revenue_staff' },
  },
  intercity: {
    unit: T('حجز', 'Booking'), units: T('الحجوزات', 'Bookings'),
    intro: T('الخطوط المنتظمة بمواعيدها في "الخطوط". هنا الرحلات الإضافية وتأجير الرحلة الكاملة.', 'Scheduled lines are in "Lines". Here are extra departures and whole-coach hire.'),
    tripTypes: { line_run: T('رحلة خط منتظم', 'Scheduled departure'), line_extra: T('رحلة إضافية', 'Extra departure'), coach_hire: T('تأجير رحلة كاملة', 'Whole-coach hire') },
    defaultTripType: 'coach_hire',
    load: { kind: 'pax', label: T('عدد الركاب (المقاعد المحجوزة)', 'Passengers (seats sold)'), short: T('مقعد', 'seats') },
    fields: [], manifest: false, lines: true, shipment: false, programs: false,
    lineLegs: { go: 'line_run', return: 'line_run' }, legNames: { go: T('ذهاب', 'Outbound'), return: T('عودة', 'Return') },
    placeKinds: ['city', 'station'],
    clientTypes: ['company', 'individual', 'ticketing'],
    revenue: { line_run: 'revenue_lines', line_extra: 'revenue_lines', coach_hire: 'revenue_lines' },
  },
  cargo: {
    unit: T('شحنة', 'Shipment'), units: T('الشحنات', 'Shipments'),
    intro: T('كل شحنة برقمها: البضاعة والوزن، التحميل والتسليم، وكود التسليم اللي بيقفل الرحلة.', 'Each shipment with its number: goods and weight, loading and delivery, and the delivery code that closes the trip.'),
    tripTypes: { freight: T('تحميل وتسليم', 'Pickup & delivery'), distribution: T('توزيع متعدد النقاط', 'Multi-drop distribution'), empty_return: T('عودة فاضية', 'Empty return') },
    defaultTripType: 'freight',
    load: { kind: 'weight', label: T('الوزن (كجم)', 'Weight (kg)'), short: T('كجم', 'kg') },
    fields: ['goods', 'pieces', 'volumeM3', 'cargoFlags'], manifest: false, lines: false, shipment: true, programs: false,
    placeKinds: ['city', 'warehouse', 'factory', 'port'],
    clientTypes: ['shipper', 'factory', 'trader', 'forwarder'],
    revenue: { freight: 'revenue_cargo', distribution: 'revenue_cargo', empty_return: 'revenue_cargo' },
  },
};
const CODES = Object.keys(PROFILES);
/* kinds every company has */
const COMMON_PLACE_KINDS = ['garage', 'client', 'restricted'];
const ALL_TRIP_TYPES = [...new Set(CODES.flatMap(a => Object.keys(PROFILES[a].tripTypes)).concat('contract'))];
const PLACE_KINDS = { city: T('مدينة', 'City'), airport: T('مطار', 'Airport'), site: T('موقع سياحي', 'Tourist site'), hotel: T('فندق', 'Hotel'), school: T('مدرسة / جامعة', 'School / university'), station: T('محطة', 'Station'), office: T('مقر عميل', 'Client site'), pickup: T('نقطة تجمّع', 'Pickup point'), warehouse: T('مخزن', 'Warehouse'), factory: T('مصنع', 'Factory'), port: T('ميناء', 'Port'), garage: T('جراج', 'Garage'), client: T('عميل', 'Client'), restricted: T('منطقة محظورة', 'Restricted area') };
const CLIENT_TYPES = { agency: T('وكالة سياحة', 'Travel agency'), hotel: T('فندق', 'Hotel'), company: T('شركة', 'Company'), individual: T('فرد', 'Individual'), school: T('مدرسة', 'School'), university: T('جامعة', 'University'), factory: T('مصنع', 'Factory'), ticketing: T('منصة تذاكر', 'Ticketing platform'), shipper: T('شاحن', 'Shipper'), trader: T('تاجر', 'Trader'), forwarder: T('شركة شحن', 'Freight forwarder') };
const CARGO_FLAGS = { refrigerated: T('مبرّدة', 'Refrigerated'), hazardous: T('خطرة', 'Hazardous'), fragile: T('قابلة للكسر', 'Fragile') };

/* the activity a trip type belongs to (null for contract trips) */
const activityOfType = type => CODES.find(a => PROFILES[a].tripTypes[type]) || null;
/* revenue account of a trip */
function revenueKey(type) {
  if (type === 'contract') return 'revenue_contract';
  const a = activityOfType(type);
  return (a && PROFILES[a].revenue[type]) || 'revenue_other';
}
const typeName = type => type === 'contract' ? T('عقد تشغيل', 'Operating contract') : ((PROFILES[activityOfType(type)] || { tripTypes: {} }).tripTypes[type] || T(type, type));

/* starting places per activity (approximate; every company edits its own).
   [code, ar, en, lat, lng, kind, radius] */
const START_PLACES = {
  EG: {
    cargo: [['CAIWH', 'مخازن العبور', 'Obour warehouses', 30.228, 31.48, 'warehouse', 1500], ['RMD10', 'العاشر من رمضان (منطقة صناعية)', '10th of Ramadan industrial zone', 30.296, 31.746, 'factory', 3000], ['OCT6', 'السادس من أكتوبر (منطقة صناعية)', '6th of October industrial zone', 29.938, 30.914, 'factory', 3000], ['ALXPT', 'ميناء الإسكندرية', 'Alexandria port', 31.186, 29.871, 'port', 2000], ['SOKPT', 'ميناء العين السخنة', 'Ain Sokhna port', 29.612, 32.349, 'port', 2000]],
    intercity: [['CAIST', 'موقف الترجمان', 'Turgoman station', 30.054, 31.239, 'station', 300], ['ALXST', 'موقف محرم بك', 'Moharam Bek station', 31.19, 29.92, 'station', 300], ['HRGST', 'محطة الغردقة', 'Hurghada station', 27.235, 33.83, 'station', 300]],
    education: [], staff: [],
  },
  SA: {
    cargo: [['RUHWH', 'مستودعات الرياض الجنوبية', 'South Riyadh warehouses', 24.57, 46.77, 'warehouse', 2000], ['RUHIC', 'المدينة الصناعية الثانية', 'Riyadh 2nd Industrial City', 24.54, 46.86, 'factory', 3000], ['JEDPT', 'ميناء جدة الإسلامي', 'Jeddah Islamic Port', 21.46, 39.17, 'port', 2000], ['DMMPT', 'ميناء الملك عبدالعزيز', 'King Abdulaziz Port Dammam', 26.5, 50.2, 'port', 2000]],
    intercity: [['RUHST', 'محطة النقل الجماعي الرياض', 'Riyadh coach station', 24.65, 46.71, 'station', 300], ['JEDST', 'محطة النقل الجماعي جدة', 'Jeddah coach station', 21.49, 39.2, 'station', 300]],
    education: [], staff: [],
  },
};
/* which of the country's starting places a company gets: tourism keeps the whole tourist list,
   the others only the cities, plus their own kinds */
function placesFor(packPlaces, country, activities) {
  const out = [];
  const kinds = new Set(activities.flatMap(a => PROFILES[a] ? PROFILES[a].placeKinds : []));
  for (const p of packPlaces) if (p[5] === 'city' || kinds.has(p[5])) out.push(p);
  for (const a of activities) for (const p of ((START_PLACES[country] || {})[a] || [])) out.push(p);
  return out;
}

/* what the browser needs for the company's activities */
function publicProfiles(activities) {
  const out = {};
  for (const a of activities) if (PROFILES[a]) out[a] = PROFILES[a];
  // names of every trip type, for older trips of an activity that was turned off
  const tripTypeNames = { contract: T('عقد تشغيل', 'Operating contract') };
  for (const a of CODES) Object.assign(tripTypeNames, PROFILES[a].tripTypes);
  return { byActivity: out, placeKinds: PLACE_KINDS, clientTypes: CLIENT_TYPES, cargoFlags: CARGO_FLAGS, commonPlaceKinds: COMMON_PLACE_KINDS, tripTypeNames };
}

module.exports = { PROFILES, CODES, ALL_TRIP_TYPES, PLACE_KINDS, CLIENT_TYPES, CARGO_FLAGS, COMMON_PLACE_KINDS, activityOfType, revenueKey, typeName, placesFor, publicProfiles, START_PLACES };
