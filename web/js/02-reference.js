/* Fixed labels shared by all companies. Company-specific reference data (vehicle types,
   places/geofences, routes, fuel prices) is loaded from the database with the snapshot. */
'use strict';
(function () {
  M.tripTypes = {
    airport: { ar: 'استقبال مطار', en: 'Airport transfer' },
    city: { ar: 'جولة داخلية', en: 'City tour' },
    intercity: { ar: 'بين المدن', en: 'Intercity' },
    hire: { ar: 'تأجير خاص', en: 'Private hire' },
  };
  M.itemCats = { oils: ['زيوت', 'Oils'], filters: ['فلاتر', 'Filters'], brakes: ['فرامل', 'Brakes'], electrical: ['كهرباء', 'Electrical'], ac: ['تكييف', 'AC'], suspension: ['عفشة', 'Suspension'], tires: ['كاوتش', 'Tires'], batteries: ['بطاريات', 'Batteries'], other: ['أخرى', 'Other'] };
  M.placeKinds = { city: ['مدينة/فنادق', 'City / hotels'], airport: ['مطار', 'Airport'], site: ['موقع سياحي', 'Tourist site'], hotel: ['فندق', 'Hotel'], garage: ['جراج', 'Garage'], client: ['موقع عميل', 'Client site'], restricted: ['منطقة محظورة', 'Restricted zone'] };
  M.expenseCats = { fuel: ['وقود', 'Fuel'], oil: ['زيوت', 'Oil'], maintenance: ['صيانة', 'Maintenance'], tolls: ['كارتة', 'Tolls'], parking: ['جراج وانتظار', 'Parking'], lodging: ['إقامة', 'Lodging'], salaries: ['رواتب', 'Salaries'], insurance: ['تأمين', 'Insurance'], license: ['رخص', 'Licenses'], subcontract: ['باطن', 'Subcontract'], other: ['أخرى', 'Other'] };
  M.inspItems = { tires: ['الكاوتش', 'Tires'], brakes: ['الفرامل', 'Brakes'], lights: ['الإضاءة', 'Lights'], ac: ['التكييف', 'AC'], clean: ['النظافة', 'Cleanliness'], extinguisher: ['طفاية الحريق', 'Fire extinguisher'], firstaid: ['شنطة الإسعافات', 'First aid kit'], documents: ['المستندات', 'Documents'] };
})();
