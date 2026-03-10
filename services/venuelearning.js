const fs = require('fs');
const path = require('path');

const VENUES_FILE = path.join(__dirname, '../data/venues.json');

function loadVenues() {
  try {
    const data = fs.readFileSync(VENUES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

function saveVenues(venues) {
  fs.writeFileSync(VENUES_FILE, JSON.stringify(venues, null, 2));
}

function saveVenue(venue) {
  const venues = loadVenues();
  const id = venue.id || Date.now().toString();
  venue.id = id;
  venues[id] = venue;
  saveVenues(venues);
  return venue;
}

function getVenue(id) {
  const venues = loadVenues();
  return venues[id] || null;
}

function getAllVenues() {
  const venues = loadVenues();
  return Object.values(venues);
}

module.exports = { saveVenue, getVenue, getAllVenues };