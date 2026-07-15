import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logTelemetry } from '@/lib/telemetry';

// Encode latitude/longitude into an 8-character geohash
function encodeGeohash(lat: number, lon: number, precision: number = 8): string {
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let isEven = true;
  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;
  let geohash = '';
  let bit = 0;
  let ch = 0;

  while (geohash.length < precision) {
    let mid;
    if (isEven) {
      mid = (lonMin + lonMax) / 2;
      if (lon > mid) {
        ch |= (1 << (4 - bit));
        lonMin = mid;
      } else {
        lonMax = mid;
      }
    } else {
      mid = (latMin + latMax) / 2;
      if (lat > mid) {
        ch |= (1 << (4 - bit));
        latMin = mid;
      } else {
        latMax = mid;
      }
    }

    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return geohash;
}

export async function POST(request: Request) {
  try {
    const { lat, lon } = await request.json();

    if (lat === undefined || lon === undefined) {
      return NextResponse.json({ error: 'Latitude and Longitude are required.' }, { status: 400 });
    }

    const geohash = encodeGeohash(Number(lat), Number(lon), 8);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // 1. Audit Database Cache
    const { data: cacheHit, error: cacheError } = await supabase
      .from('weather_cache')
      .select('weather_string, weather_data')
      .eq('geohash', geohash)
      .gt('fetched_at', oneHourAgo)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cacheError) {
      console.warn('Weather cache audit error:', cacheError.message);
    }

    if (cacheHit) {
      // Log cached cache hit telemetry (0 cost)
      await logTelemetry('Pirate_Weather_API', 0, 0, { geohash, cache: 'hit' });
      return NextResponse.json({ success: true, weather: cacheHit.weather_string, cache: 'hit' });
    }

    // 2. Cache Miss: Fetch Weather
    const apiKey = process.env.PIRATE_WEATHER_API_KEY || '';
    let weatherString = '';
    let rawData: any = {};

    if (apiKey) {
      const url = `https://api.pirateweather.net/forecast/${apiKey}/${lat},${lon}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Pirate Weather API responded with status ${response.status}`);
      }
      rawData = await response.json();
      
      const temp = Math.round(rawData.currently?.temperature || 70);
      const summary = rawData.currently?.summary || 'Clear';
      const precip = Math.round((rawData.currently?.precipProbability || 0) * 100);
      const wind = Math.round(rawData.currently?.windSpeed || 5);
      
      const today = rawData.daily?.data?.[0];
      const tomorrow = rawData.daily?.data?.[1];
      let forecastPart = '';
      
      if (today && tomorrow) {
        const todayHigh = Math.round(today.temperatureMax || temp);
        const todayLow = Math.round(today.temperatureMin || temp);
        const todayRain = Math.round((today.precipProbability || 0) * 100);
        const todaySum = today.summary || summary;
        
        const tomHigh = Math.round(tomorrow.temperatureMax || temp);
        const tomLow = Math.round(tomorrow.temperatureMin || temp);
        const tomRain = Math.round((tomorrow.precipProbability || 0) * 100);
        const tomSum = tomorrow.summary || 'Clear';

        forecastPart = ` | Today's Forecast: High ${todayHigh}°F, Low ${todayLow}°F, ${todayRain}% rain, ${todaySum} | Tomorrow's Forecast: High ${tomHigh}°F, Low ${tomLow}°F, ${tomRain}% rain, ${tomSum}`;
      }
      
      weatherString = `Currently: ${temp}°F, ${summary}, Wind: ${wind}mph${forecastPart}`;
    } else {
      // Robust Mock Fallback if API Key is not set
      const mockTemps = [65, 72, 78, 68, 55, 60];
      const mockSummaries = ['Sunny', 'Partly Cloudy', 'Clear', 'Overcast', 'Breezy'];
      const randomTemp = mockTemps[Math.floor(Math.random() * mockTemps.length)];
      const randomSummary = mockSummaries[Math.floor(Math.random() * mockSummaries.length)];
      
      rawData = { mock: true, temperature: randomTemp, summary: randomSummary };
      weatherString = `Currently: ${randomTemp}°F, ${randomSummary} (Mock) | Today's Forecast: High ${randomTemp + 6}°F, Low ${randomTemp - 10}°F, 0% rain, Sunny | Tomorrow's Forecast: High ${randomTemp + 4}°F, Low ${randomTemp - 8}°F, 0% rain, Clear`;
    }

    // 3. Save to Cache
    const { error: insertError } = await supabase.from('weather_cache').insert([
      {
        geohash,
        weather_string: weatherString,
        weather_data: rawData,
      },
    ]);

    if (insertError) {
      console.warn('Failed to insert weather cache record:', insertError.message);
    }

    // 4. Log Telemetry (1 token unit representing weather transaction)
    await logTelemetry('Pirate_Weather_API', 1, 0, { geohash, cache: 'miss' });

    return NextResponse.json({ success: true, weather: weatherString, cache: 'miss' });
  } catch (error: any) {
    console.error('Weather route error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch weather' }, { status: 500 });
  }
}
