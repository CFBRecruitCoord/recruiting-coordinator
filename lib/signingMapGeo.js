const { geoAlbersUsa } = require('d3-geo');
const cities = require('cities.json');

// Same projection parameters that produced the static state-path/school-marker
// coordinates baked into views/index.html's #usMap - verified by projecting
// several real campus coordinates (Texas, Miami, Washington, Florida,
// Michigan) and confirming the output lands within a pixel or two of that
// map's existing hand-placed school markers.
const project = geoAlbersUsa().scale(1300).translate([487.5, 305]);

// The save stores home state as a squashed, space-free name (confirmed via
// live data: "SouthCarolina", "NorthCarolina") rather than the two-letter
// code cities.json itself uses for admin1 - this bridges the two.
const STATE_NAME_TO_ABBR = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
    colorado: 'CO', connecticut: 'CT', delaware: 'DE', districtofcolumbia: 'DC',
    florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
    indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
    maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
    minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
    nebraska: 'NE', nevada: 'NV', newhampshire: 'NH', newjersey: 'NJ',
    newmexico: 'NM', newyork: 'NY', northcarolina: 'NC', northdakota: 'ND',
    ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
    rhodeisland: 'RI', southcarolina: 'SC', southdakota: 'SD', tennessee: 'TN',
    texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
    westvirginia: 'WV', wisconsin: 'WI', wyoming: 'WY'
};

// Approximate geographic center of each state - used only when a signee's
// hometown city can't be matched in the city gazetteer (misspelling, a town
// too small to be listed, etc.), so every signee with a recognized home
// state still gets *some* point on the map rather than being dropped.
const STATE_CENTROIDS = {
    AL: [32.806671, -86.791130], AK: [61.370716, -152.404419], AZ: [33.729759, -111.431221],
    AR: [34.969704, -92.373123], CA: [36.116203, -119.681564], CO: [39.059811, -105.311104],
    CT: [41.597782, -72.755371], DE: [39.318523, -75.507141], DC: [38.897438, -77.026817],
    FL: [27.766279, -81.686783], GA: [33.040619, -83.643074], HI: [21.094318, -157.498337],
    ID: [44.240459, -114.478828], IL: [40.349457, -88.986137], IN: [39.849426, -86.258278],
    IA: [42.011539, -93.210526], KS: [38.526600, -96.726486], KY: [37.668140, -84.670067],
    LA: [31.169546, -91.867805], ME: [44.693947, -69.381927], MD: [39.063946, -76.802101],
    MA: [42.230171, -71.530106], MI: [43.326618, -84.536095], MN: [45.694454, -93.900192],
    MS: [32.741646, -89.678696], MO: [38.456085, -92.288368], MT: [46.921925, -110.454353],
    NE: [41.125370, -98.268082], NV: [38.313515, -117.055374], NH: [43.452492, -71.563896],
    NJ: [40.298904, -74.521011], NM: [34.840515, -106.248482], NY: [42.165726, -74.948051],
    NC: [35.630066, -79.806419], ND: [47.528912, -99.784012], OH: [40.388783, -82.764915],
    OK: [35.565342, -96.928917], OR: [44.572021, -122.070938], PA: [40.590752, -77.209755],
    RI: [41.680893, -71.511780], SC: [33.856892, -80.945007], SD: [44.299782, -99.438828],
    TN: [35.747845, -86.692345], TX: [31.054487, -97.563461], UT: [40.150032, -111.862434],
    VT: [44.045876, -72.710686], VA: [37.769337, -78.169968], WA: [47.400902, -121.490494],
    WV: [38.491226, -80.954453], WI: [44.268543, -89.616508], WY: [42.755966, -107.302490]
};

function squash(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

// cities.json carries ~17k US cities (name/lat/lng/admin1 state code) -
// keyed by "city|state" so a hometown + home state pair resolves to one
// point. Duplicate city names across different states are common ("Houston"
// exists in TX, MS, MO, PA, AK) but the state code disambiguates correctly;
// duplicate city+state pairs (rare) just take the first match, which is
// close enough for a visualization at this scale.
const cityLookup = new Map();
cities.filter(c => c.country === 'US').forEach(c => {
    const key = `${squash(c.name)}|${c.admin1}`;
    if (!cityLookup.has(key)) cityLookup.set(key, [Number(c.lat), Number(c.lng)]);
});

/**
 * Resolves a signee's hometown/home state to a map point, falling back from
 * exact city to state centroid, and returns null only when the home state
 * itself isn't recognized at all (no data to plot).
 */
function resolveLatLng(hometown, homeState) {
    const abbr = STATE_NAME_TO_ABBR[squash(homeState)];
    if (!abbr) return null;

    const cityKey = `${squash(hometown)}|${abbr}`;
    const cityMatch = cityLookup.get(cityKey);
    if (cityMatch) return { lat: cityMatch[0], lng: cityMatch[1], precision: 'city' };

    const centroid = STATE_CENTROIDS[abbr];
    if (!centroid) return null;
    return { lat: centroid[0], lng: centroid[1], precision: 'state' };
}

/**
 * Resolves + projects a signee's hometown into the same SVG coordinate
 * space as the existing #usMap (viewBox "10.49 4.98 954.57 609.59"). Returns
 * null when the home state can't be recognized (e.g. missing data).
 */
function geoProjectHometown(hometown, homeState) {
    const resolved = resolveLatLng(hometown, homeState);
    if (!resolved) return null;
    const point = project([resolved.lng, resolved.lat]);
    if (!point) return null;
    return { x: point[0], y: point[1], precision: resolved.precision };
}

module.exports = { geoProjectHometown };
