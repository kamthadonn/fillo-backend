// weathersignals.js — Weekend weather → event attendance prediction
//
// Uses Open-Meteo (completely FREE, no key needed, no account)
// Converts city to coordinates, fetches 7-day forecast, calculates
// an "attendance signal" (rainy weekend = digital push, nice weather = outdoor competition)

const axios = require('axios');

// Simple city → lat/lng lookup for common US cities
const CITY_COORDS = {
  'houston': { lat: 29.7604, lng: -95.3698 },
  'los angeles': { lat: 34.0522, lng: -118.2437 },
  'new york': { lat: 40.7128, lng: -74.0060 },
  'chicago': { lat: 41.8781, lng: -87.6298 },
  'miami': { lat: 25.7617, lng: -80.1918 },
  'atlanta': { lat: 33.7490, lng: -84.3880 },
  'dallas': { lat: 32.7767, lng: -96.7970 },
  'phoenix': { lat: 33.4484, lng: -112.0740 },
  'las vegas': { lat: 36.1699, lng: -115.1398 },
  'nashville': { lat: 36.1627, lng: -86.7816 },
  'austin': { lat: 30.2672, lng: -97.7431 },
  'new orleans': { lat: 29.9511, lng: -90.0715 },
  'san francisco': { lat: 37.7749, lng: -122.4194 },
  'seattle': { lat: 47.6062, lng: -122.3321 },
  'denver': { lat: 39.7392, lng: -104.9903 },
  'boston': { lat: 42.3601, lng: -71.0589 },
  'philadelphia': { lat: 39.9526, lng: -75.1652 },
  'minneapolis': { lat: 44.9778, lng: -93.2650 },
  'portland': { lat: 45.5051, lng: -122.6750 },
  'charlotte': { lat: 35.2271, lng: -80.8431 },
};

function getCityCoords(city = '') {
  const key = city.toLowerCase().trim();
  return CITY_COORDS[key] || null;
}

async function getWeatherSignals(city = '') {
  const coords = getCityCoords(city);

  if (!coords) {
    return {
      available: false,
      signal: `Weather signals not available for ${city || 'unknown city'}`,
      status: 'city_not_mapped',
      forecast: [],
    };
  }

  try {
    const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: coords.lat,
        longitude: coords.lng,
        daily: 'precipitation_sum,temperature_2m_max,weathercode',
        timezone: 'America/Chicago',
        forecast_days: 7,
      },
      timeout: 6000,
    });

    const daily = res.data?.daily || {};
    const times = daily.time || [];
    const precip = daily.precipitation_sum || [];
    const temps = daily.temperature_2m_max || [];
    const codes = daily.weathercode || [];

    const forecast = times.map((date, i) => {
      const rain = precip[i] || 0;
      const tempC = temps[i] || 0;
      const tempF = Math.round(tempC * 9 / 5 + 32);
      const code = codes[i] || 0;
      const isWeekend = [5, 6].includes(new Date(date).getDay());
      const isRainy = rain > 5 || (code >= 61 && code <= 82);
      const isGreat = rain < 2 && tempF > 60 && tempF < 92 && code < 30;

      return {
        date,
        tempF,
        rain: rain.toFixed(1),
        isWeekend,
        isRainy,
        isGreat,
        signal: isWeekend
          ? isRainy
            ? 'Rainy weekend → push digital/indoor content hard'
            : isGreat
            ? 'Great weather → outdoor competition is high, create urgency'
            : 'Average weekend weather'
          : null,
        weatherLabel: code >= 95 ? 'Stormy' : code >= 61 ? 'Rainy' : code >= 30 ? 'Cloudy' : 'Clear',
      };
    });

    const weekendDays = forecast.filter(d => d.isWeekend);
    const rainyWeekend = weekendDays.some(d => d.isRainy);
    const greatWeekend = weekendDays.every(d => d.isGreat);

    return {
      available: true,
      city,
      forecast: forecast.slice(0, 7),
      weekendSignal: rainyWeekend
        ? 'Rainy weekend ahead — push digital-first content, emphasize indoor experience'
        : greatWeekend
        ? 'Beautiful weekend — outdoor activity is up, lean into FOMO and exclusivity'
        : 'Normal weekend weather — standard content mix',
      attendanceBoost: rainyWeekend ? 'indoor' : greatWeekend ? 'fomo' : 'neutral',
      source: 'Open-Meteo (free)',
    };
  } catch (err) {
    console.warn('[Weather]:', err.message);
    return { available: false, signal: 'Weather data temporarily unavailable', forecast: [] };
  }
}

module.exports = { getWeatherSignals };