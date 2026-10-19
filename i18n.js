/**
 * i18n.js — Swedish (default) + English UI strings. Every user-visible
 * string goes through t(); scene content carries its own _sv/_en fields.
 */
const _strings = {
  sv: {
    title: 'Bussolyckan på riksväg 25',
    subtitle: 'Måndag 5 oktober 2026 · Rekonstruktion av insatsen',
    weekday_mon: 'måndag', weekday_tue: 'tisdag', month_oct: 'oktober',
    play: 'Spela', pause: 'Pausa', speed: 'Hastighet',
    story_mode: 'Berättarläge', story_mode_tip: 'Kameran följer händelserna och pausar kort vid varje händelse',
    lang_tip: 'Språk: svenska, engelska, eller svenska med engelsk översättning (tangent L)',
    translation: 'Engelsk översättning',
    documented: 'Dokumenterat', estimated: 'Uppskattat',
    documented_tip: 'Tid och innehåll enligt publicerade källor',
    estimated_tip: 'Modellerat: plats eller tid är inte publicerad',
    source: 'Källa',
    hospitals: 'Mottagna patienter', units: 'Enheter', legend: 'Teckenförklaring',
    doc_total: 'enligt Region Kronoberg',
    light_injured: 'lindrigt skadade', light_injured_n: 'Busslast lindrigt skadade',
    status_idle: 'I beredskap', status_enroute: 'På väg till olycksplatsen', status_onscene: 'På plats',
    status_transport: 'Transporterar patient', status_handover: 'Överlämning', status_returning: 'Återvänder',
    status_done: 'Avslutad', status_crashed: 'Olycksbussen', status_driving: 'I trafik',
    to: 'till', min: 'min', eta: 'ankomst',
    scene: 'olycksplatsen',
    leg_alarm_scene: 'Larm → plats', leg_scene_hosp: 'Plats → sjukhus',
    leg_ambulance: 'Ambulans', leg_heli: 'Räddningshelikopter', leg_fire: 'Räddningstjänst', leg_police: 'Polis',
    leg_bus845: 'Linje 845 (olycksbussen)', leg_bus: 'Buss', leg_transit: 'Kollektivtrafik (bakgrund)',
    leg_closure: 'Avstängd väg', leg_crash: 'Olycksplats', leg_hospital: 'Sjukhus', leg_approx: 'Ungefärligt läge',
    gantt: 'Tidslinje per enhet', gantt_tip: 'Visa/dölj enheternas tidslinje',
    about: 'Om kartan', close: 'Stäng',
    about_body: 'Rekonstruktionen bygger på pressmeddelanden från Region Kronoberg, Polisen, SVT, Sveriges Radio, Smålandsposten och TT. Antal patienter per sjukhus och de tidsstämplar som visas som <b>Dokumenterat</b> kommer från dessa källor. Vilka enheter som åkte, deras körvägar och exakta tider är <b>uppskattade</b> (vägnät från OpenStreetMap/OSRM, blåljuskörning ≈ 80 % av normal restid) eftersom de inte är publicerade. Byggnader kommer från OpenStreetMap; kollektivtrafik och flyg i bakgrunden är syntetiska och endast illustrativa. Kartdata © OpenStreetMap-bidragsgivare.',
    follow: 'Följ', unfollow: 'Sluta följa', following: 'Följer',
    focus: '🎯 Fokus på händelsen', focus_tip: 'Visa det som händer just nu (tangent F)',
    compact_panel: 'Visa bara tider (tangent T)', expand_panel: 'Visa texterna (tangent T)',
    hint_keys: 'Mellanslag: spela/pausa · ←/→: händelser · F: fokus · T: kompakt · L: språk · klicka på ett fordon: följ',
    approx: 'ungefärligt läge',
    next_day: 'Tisdag 6 okt',
    killed: 'avliden', serious: 'svårt skadade', affected: 'drabbade',
    onboard: 'ombord',
    transfer: 'Vidaretransport', time_unknown: 'tid okänd',
    loading: 'Laddar karta…',
    about_h_method: 'Underlag och metod', about_h_sources: 'Källor', about_h_author: 'Skapad av',
    about_role: 'Docent i datavetenskap, Institutionen för datavetenskap och medieteknik, Fakultetsområdet för teknik, Linnéuniversitetet, Växjö',
    about_disclaimer: 'Detta är ett fristående forsknings- och visualiseringsprojekt och ingen officiell produkt från Region Kronoberg, Polisen eller räddningstjänsten. Kontakta mig gärna med rättelser eller kompletterande uppgifter.',
    made_by: 'Skapad av', about_contact: 'Kontakt', about_web: 'Webbplats', about_code: 'Källkod',
    tip_follow: 'Klicka för att följa fordonet', tip_following: 'Följs · klicka på tom karta eller Esc för att släppa',
    tip_dep: 'Avfärd', tip_left: 'kvar', tip_avg: 'snittfart', tip_base: 'Station', tip_mutual: 'Ömsesidig hjälp från grannregion',
    tip_patients: 'Patienter lämnade', tip_modelled: 'Uppskattat: enhet, rutt och tider modellerade',
    tip_synthetic: 'Syntetisk tidtabell (bakgrundstrafik)', tip_illustrative: 'Illustrativ flygtrafik',
    tip_line: 'linje', tip_tram: 'Spårvagn', tip_train: 'Regionaltåg', tip_ic: 'Öresundståg', tip_flight: 'Flyg',
    tip_took_off: 'Lyfte', tip_lands: 'Landar', tip_from: 'från', tip_crash_at: 'Olyckan inträffade',
    tip_loading: 'lastar patient', tip_handover: 'överlämning av patient', tip_boarding: 'påstigning',
    tip_working: 'arbetar på platsen', tip_startup: 'startar',
  },
  en: {
    title: 'The Rv 25 bus accident',
    subtitle: 'Monday 5 October 2026 · Reconstruction of the response',
    weekday_mon: 'Monday', weekday_tue: 'Tuesday', month_oct: 'October',
    play: 'Play', pause: 'Pause', speed: 'Speed',
    story_mode: 'Story mode', story_mode_tip: 'Camera follows the events and pauses briefly at each one',
    lang_tip: 'Language: Swedish, English, or Swedish with English translation (key L)',
    translation: 'English translation',
    documented: 'Documented', estimated: 'Estimated',
    documented_tip: 'Time and content from published sources',
    estimated_tip: 'Modelled: location or time not published',
    source: 'Source',
    hospitals: 'Patients received', units: 'Units', legend: 'Legend',
    doc_total: 'per Region Kronoberg',
    light_injured: 'lightly injured', light_injured_n: 'Busload of lightly injured',
    status_idle: 'Standby', status_enroute: 'En route to scene', status_onscene: 'On scene',
    status_transport: 'Transporting patient', status_handover: 'Handover', status_returning: 'Returning',
    status_done: 'Finished', status_crashed: 'The crashed bus', status_driving: 'In service',
    to: 'to', min: 'min', eta: 'arrival',
    scene: 'the scene',
    leg_alarm_scene: 'Alarm → scene', leg_scene_hosp: 'Scene → hospital',
    leg_ambulance: 'Ambulance', leg_heli: 'Rescue helicopter', leg_fire: 'Fire & rescue', leg_police: 'Police',
    leg_bus845: 'Line 845 (the crashed bus)', leg_bus: 'Bus', leg_transit: 'Public transport (background)',
    leg_closure: 'Closed road', leg_crash: 'Accident site', leg_hospital: 'Hospital', leg_approx: 'Approximate location',
    gantt: 'Unit timeline', gantt_tip: 'Show/hide the per-unit timeline',
    about: 'About this map', close: 'Close',
    about_body: 'The reconstruction is based on press releases from Region Kronoberg, the Police, SVT, Swedish Radio, Smålandsposten and TT. Patient counts per hospital and the timestamps marked <b>Documented</b> come from those sources. Which units responded, their routes and exact times are <b>estimated</b> (OpenStreetMap/OSRM road network, blue-light driving ≈ 80 % of normal travel time) because they are not published. Buildings come from OpenStreetMap; background public transport and flights are synthetic and illustrative only. Map data © OpenStreetMap contributors.',
    follow: 'Follow', unfollow: 'Stop following', following: 'Following',
    focus: '🎯 Focus on the action', focus_tip: 'Show what is happening right now (key F)',
    compact_panel: 'Show times only (key T)', expand_panel: 'Show the texts (key T)',
    hint_keys: 'Space: play/pause · ←/→: events · F: focus · T: compact · L: language · click a vehicle: follow',
    approx: 'approximate location',
    next_day: 'Tue 6 Oct',
    killed: 'dead', serious: 'serious', affected: 'affected',
    onboard: 'on board',
    transfer: 'Onward transfer', time_unknown: 'time unknown',
    loading: 'Loading map…',
    about_h_method: 'Data and method', about_h_sources: 'Sources', about_h_author: 'Made by',
    about_role: 'Associate Professor, Department of Computer Science and Media Technology, Faculty of Technology, Linnaeus University, Växjö, Sweden',
    about_disclaimer: 'This is an independent research and visualization project, not an official product of Region Kronoberg, the Police or the rescue services. Corrections and additional information are very welcome.',
    made_by: 'Made by', about_contact: 'Contact', about_web: 'Website', about_code: 'Source code',
    tip_follow: 'Click to follow this vehicle', tip_following: 'Following · click empty map or Esc to release',
    tip_dep: 'Departs', tip_left: 'left', tip_avg: 'avg. speed', tip_base: 'Base', tip_mutual: 'Mutual aid from neighbouring region',
    tip_patients: 'Patients delivered', tip_modelled: 'Estimated: unit, route and times modelled',
    tip_synthetic: 'Synthetic timetable (background traffic)', tip_illustrative: 'Illustrative air traffic',
    tip_line: 'line', tip_tram: 'Tram', tip_train: 'Regional train', tip_ic: 'Öresundståg', tip_flight: 'Flight',
    tip_took_off: 'Took off', tip_lands: 'Lands', tip_from: 'from', tip_crash_at: 'Crash occurred',
    tip_loading: 'loading patient', tip_handover: 'patient handover', tip_boarding: 'boarding',
    tip_working: 'working at the scene', tip_startup: 'starting up',
  },
};

let _lang = 'sv';
try { _lang = localStorage.getItem('rv25.lang') || 'sv'; } catch (_) { /* private mode */ }

// 'both' = Swedish UI with English translations under the story text.
export function t(key) { return (_strings[_lang] && _strings[_lang][key]) ?? _strings.sv[key] ?? key; }
export function lang() { return _lang === 'en' ? 'en' : 'sv'; }
export function langMode() { return _lang; }
export function bilingual() { return _lang === 'both'; }
export function pick(obj, base) { return obj[`${base}_${_lang}`] ?? obj[`${base}_sv`] ?? obj[_lang] ?? obj.sv ?? ''; }
export function setLang(l) {
  _lang = l;
  try { localStorage.setItem('rv25.lang', l); } catch (_) { /* ignore */ }
  document.documentElement.lang = l === 'en' ? 'en' : 'sv';
  applyStatic();
}
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
}
