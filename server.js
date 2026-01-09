// server.js - Backend server using ESPN's FREE API (no API key needed!)
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API Keys
const CBB_API_KEY = process.env.CBB_API_KEY; // CollegeBasketballData.com API key
const CFB_API_KEY = process.env.CFB_API_KEY; // CollegeFootballData.com API key

// Team ID Mapping (ESPN ID -> CBB API ID)
let teamIdMapping = new Map();

// Cache configuration
const CACHE_DIR = path.join(__dirname, 'cache');
const NCAAB_CACHE_FILE = path.join(CACHE_DIR, 'ncaab_games.json');
const NCAAF_CACHE_FILE = path.join(CACHE_DIR, 'ncaaf_games.json');
const TEAM_MAPPING_FILE = path.join(__dirname, 'team_id_mapping.csv');
let ncaabCache = null;
let ncaafCache = null;
let lastNCAABCacheUpdate = null;
let lastNCAAFCacheUpdate = null;

// ESPN API Configuration (FREE - no API key needed!)
const ESPN_ENDPOINTS = {
    'baseball_mlb': 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
    'americanfootball_nfl': 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
    'basketball_ncaab': 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
    'americanfootball_ncaaf': 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
    'basketball_nba': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
};

const SPORT_NAMES = {
    'baseball_mlb': 'MLB',
    'americanfootball_nfl': 'NFL',
    'basketball_ncaab': 'NCAA Basketball',
    'americanfootball_ncaaf': 'NCAA Football',
    'basketball_nba': 'NBA'
};

// ===========================================
// TEAM ID MAPPING
// ===========================================

async function loadTeamIdMapping() {
    try {
        const csvData = await fs.readFile(TEAM_MAPPING_FILE, 'utf8');
        const lines = csvData.trim().split('\n');
        
        // Skip header row
        for (let i = 1; i < lines.length; i++) {
            const [espnId, cbbId] = lines[i].split(',').map(id => id.trim());
            if (espnId && cbbId) {
                teamIdMapping.set(espnId, cbbId);
            }
        }
        
        console.log(`✅ Loaded ${teamIdMapping.size} team ID mappings`);
    } catch (error) {
        console.error('⚠️  Error loading team ID mapping:', error.message);
        console.log('   Will fall back to name-based matching');
    }
}

// ===========================================
// CACHE MANAGEMENT FOR NCAA BASKETBALL
// ===========================================

async function ensureCacheDir() {
    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (err) {
        console.error('Error creating cache directory:', err);
    }
}

async function loadCacheFromDisk(sport) {
    try {
        const cacheFile = sport === 'basketball' ? NCAAB_CACHE_FILE : NCAAF_CACHE_FILE;
        const data = await fs.readFile(cacheFile, 'utf8');
        const parsed = JSON.parse(data);
        
        if (sport === 'basketball') {
            ncaabCache = parsed.data;
            lastNCAABCacheUpdate = new Date(parsed.timestamp);
            console.log(`✅ Loaded NCAA Basketball cache from disk (${lastNCAABCacheUpdate.toLocaleString()})`);
        } else {
            ncaafCache = parsed.data;
            lastNCAAFCacheUpdate = new Date(parsed.timestamp);
            console.log(`✅ Loaded NCAA Football cache from disk (${lastNCAAFCacheUpdate.toLocaleString()})`);
        }
        return true;
    } catch (err) {
        console.log(`No ${sport} cache file found or error reading cache`);
        return false;
    }
}

async function saveCacheToDisk(sport, cacheData) {
    try {
        await ensureCacheDir();
        const cacheFile = sport === 'basketball' ? NCAAB_CACHE_FILE : NCAAF_CACHE_FILE;
        const dataToSave = {
            timestamp: new Date().toISOString(),
            data: cacheData
        };
        await fs.writeFile(cacheFile, JSON.stringify(dataToSave, null, 2));
        console.log(`✅ Saved NCAA ${sport === 'basketball' ? 'Basketball' : 'Football'} cache to disk`);
    } catch (err) {
        console.error('Error saving cache to disk:', err);
    }
}

async function downloadAllNCAAFData() {
    if (!CFB_API_KEY) {
        console.log('⚠️  CFB_API_KEY not configured, skipping NCAA Football cache update');
        return;
    }

    console.log('🏈 Downloading NCAA Football data from CollegeFootballData.com...');

    try {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth(); // 0-11
        
        // Determine which years to fetch
        const yearsToFetch = [];
        
        if (currentMonth === 0) {
            // January: Fetch both current year (bowl games) and previous year
            yearsToFetch.push(currentYear);     // e.g., 2026 (current season bowl games)
            yearsToFetch.push(currentYear - 1); // e.g., 2025 (previous season)
            console.log(`Fetching games for ${currentYear} and ${currentYear - 1} seasons (January)...`);
        } else {
            // All other months: Fetch current year only
            yearsToFetch.push(currentYear);
            console.log(`Fetching games for ${currentYear} season...`);
        }

        const allGames = [];

        // Fetch games for each year
        for (const year of yearsToFetch) {
            const url = `https://api.collegefootballdata.com/games?year=${year}&seasonType=regular`;
            
            console.log(`Fetching: ${url}`);

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${CFB_API_KEY}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.log(`⚠️  CFB API returned ${response.status} for year ${year}`);
                continue;
            }

            let data = await response.json();
            
            if (!Array.isArray(data)) {
                data = data.data || [];
            }

            console.log(`  ✅ Downloaded ${data.length} games for ${year} season`);
            allGames.push(...data);
        }

        console.log(`✅ Total: ${allGames.length} football games`);

        // Debug: Check structure of first game
        if (allGames.length > 0) {
            console.log('Sample game structure:', JSON.stringify(allGames[0], null, 2));
        }

        // Don't filter for completed games - include all games
        // This allows us to see upcoming games and scheduled games
        const gamesByTeam = {};
        
        allGames.forEach(game => {
            // Check multiple possible field name variations
            const homeTeam = game.home_team || game.homeTeam || game.home;
            const awayTeam = game.away_team || game.awayTeam || game.away;
            
            if (!homeTeam || !awayTeam) {
                console.log('⚠️  Skipping game with missing team names:', game.id);
                return;
            }
            
            // Add to home team's list
            if (homeTeam) {
                if (!gamesByTeam[homeTeam]) {
                    gamesByTeam[homeTeam] = [];
                }
                gamesByTeam[homeTeam].push({
                    id: game.id,
                    startDate: game.start_date || game.startDate,
                    homeTeam: homeTeam,
                    awayTeam: awayTeam,
                    homePoints: game.home_points || game.homePoints || 0,
                    awayPoints: game.away_points || game.awayPoints || 0,
                    isHome: true,
                    opponent: awayTeam
                });
            }
            
            // Add to away team's list
            if (awayTeam) {
                if (!gamesByTeam[awayTeam]) {
                    gamesByTeam[awayTeam] = [];
                }
                gamesByTeam[awayTeam].push({
                    id: game.id,
                    startDate: game.start_date || game.startDate,
                    homeTeam: homeTeam,
                    awayTeam: awayTeam,
                    homePoints: game.home_points || game.homePoints || 0,
                    awayPoints: game.away_points || game.awayPoints || 0,
                    isHome: false,
                    opponent: homeTeam
                });
            }
        });

        // Sort each team's games by date (most recent first)
        Object.keys(gamesByTeam).forEach(teamName => {
            gamesByTeam[teamName].sort((a, b) => {
                const dateA = new Date(a.startDate);
                const dateB = new Date(b.startDate);
                return dateB - dateA;
            });
        });

        ncaafCache = gamesByTeam;
        lastNCAAFCacheUpdate = new Date();

        await saveCacheToDisk('football', ncaafCache);

        console.log(`✅ NCAA Football cache updated at ${lastNCAAFCacheUpdate.toLocaleString()}`);
        console.log(`   Cached data for ${Object.keys(gamesByTeam).length} teams`);
    } catch (error) {
        console.error('❌ Error downloading NCAA Football data:', error.message);
    }
}

async function downloadAllNCAABData() {
    if (!CBB_API_KEY) {
        console.log('⚠️  CBB_API_KEY not configured, skipping NCAA Basketball cache update');
        return;
    }

    console.log('🏀 Downloading NCAA Basketball data from CollegeBasketballData.com...');

    try {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        
        // College basketball season format: use the END year of the season
        const season = currentMonth < 6 ? currentYear : currentYear + 1;

        // Fetch ALL games for the entire season (no date range)
        const url = `https://api.collegebasketballdata.com/games?season=${season}`;
        
        console.log(`Fetching ALL games for ${season} season (entire season)...`);

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${CBB_API_KEY}`,
                'Accept': 'application/json',
                'User-Agent': 'MattsBettingTools/1.0'
            }
        });

        if (!response.ok) {
            throw new Error(`CBB API Error: ${response.status} ${response.statusText}`);
        }

        let data = await response.json();
        
        // Handle both array and {data: []} response formats
        if (!Array.isArray(data)) {
            data = data.data || [];
        }

        console.log(`✅ Downloaded ${data.length} games from CBB API (entire season)`);

        // Filter for completed games only (status = 'final' and has scores)
        const completedGames = data.filter(game => {
            // Check if game has final status and both teams have scores
            const hasScores = game.homePoints != null && game.awayPoints != null;
            const isCompleted = game.status === 'final' || game.status === 'Final';
            return hasScores && isCompleted;
        });

        console.log(`✅ ${completedGames.length} completed games`);

        // Store the raw games array - keep homeTeamId and awayTeamId intact for searching
        ncaabCache = completedGames;
        lastNCAABCacheUpdate = new Date();

        await saveCacheToDisk('basketball', ncaabCache);

        console.log(`✅ NCAA Basketball cache updated successfully at ${lastNCAABCacheUpdate.toLocaleString()}`);
        console.log(`   Cached ${completedGames.length} completed games from entire ${season} season`);
    } catch (error) {
        console.error('❌ Error downloading NCAA Basketball data:', error.message);
    }
}

function scheduleNCAAUpdates() {
    // Calculate next 2 AM EST
    function getNextUpdateTime() {
        const now = new Date();
        const next = new Date(now);
        
        // EST is UTC-5
        const estOffset = -5 * 60;
        const nowEST = new Date(now.getTime() + (estOffset + now.getTimezoneOffset()) * 60000);
        
        next.setHours(2, 0, 0, 0);
        
        if (nowEST.getHours() >= 2) {
            next.setDate(next.getDate() + 1);
        }
        
        return next;
    }

    function scheduleNext() {
        const next = getNextUpdateTime();
        const msUntilNext = next.getTime() - Date.now();
        
        console.log(`📅 Next NCAA cache update scheduled for ${next.toLocaleString()}`);
        
        setTimeout(async () => {
            await downloadAllNCAABData();
            await downloadAllNCAAFData();
            scheduleNext();
        }, msUntilNext);
    }

    scheduleNext();
}

// ===========================================
// API ENDPOINTS
// ===========================================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        apiProvider: 'ESPN (Free - No API key needed!)'
    });
});

// Main endpoint to get all games data
app.get('/api/games', async (req, res) => {
    try {
        console.log('Fetching live data from ESPN API...');
        const allGames = await fetchAllGamesData();
        res.json(allGames);
    } catch (error) {
        console.error('Error fetching games:', error);
        res.status(500).json({ 
            error: 'Failed to fetch games data',
            message: error.message 
        });
    }
});

// Endpoint for individual game details with stats
app.get('/api/game/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;
        
        console.log(`Fetching details for game ${gameId}...`);
        
        const allGames = await fetchAllGamesData();
        const game = allGames.find(g => g.id === gameId);
        
        if (!game) {
            return res.status(404).json({ 
                error: 'Game not found',
                message: `No game found with ID: ${gameId}`
            });
        }

        const stats = await fetchGameStats(game);
        
        res.json({
            ...game,
            stats: stats
        });
    } catch (error) {
        console.error('Error fetching game details:', error);
        res.status(500).json({ 
            error: 'Failed to fetch game details',
            message: error.message 
        });
    }
});

// New endpoint to get all teams
app.get('/api/teams', async (req, res) => {
    try {
        console.log('Fetching all teams...');
        const teams = await fetchAllTeams();
        res.json(teams);
    } catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ 
            error: 'Failed to fetch teams',
            message: error.message 
        });
    }
});

// New endpoint to get team history (last 3 games)
app.get('/api/team-history/:teamId', async (req, res) => {
    try {
        const { teamId } = req.params;
        const { sport } = req.query;
        
        if (!sport) {
            return res.status(400).json({ 
                error: 'Sport parameter required',
                message: 'Please provide sport parameter'
            });
        }

        console.log(`Fetching history for team ${teamId} in ${sport}...`);
        const history = await fetchTeamHistory(teamId, sport);
        res.json(history);
    } catch (error) {
        console.error('Error fetching team history:', error);
        res.status(500).json({ 
            error: 'Failed to fetch team history',
            message: error.message 
        });
    }
});

// ===========================================
// HELPER FUNCTIONS - ESPN API
// ===========================================

async function fetchESPNData(sport) {
    try {
        const url = ESPN_ENDPOINTS[sport];
        if (!url) {
            console.log(`No ESPN endpoint for sport: ${sport}`);
            return { events: [] };
        }

        // Basketball sports: Only fetch today's games
        if (sport === 'basketball_ncaab' || sport === 'basketball_nba') {
            // Use EST timezone specifically
            const estDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
            const year = estDate.getFullYear();
            const month = String(estDate.getMonth() + 1).padStart(2, '0');
            const day = String(estDate.getDate()).padStart(2, '0');
            const dateStr = `${year}${month}${day}`;
            
            // For NCAA Basketball, add groups=50 (D1 games) and limit=500 to get ALL games
            let urlWithDate;
            if (sport === 'basketball_ncaab') {
                urlWithDate = `${url}?dates=${dateStr}&groups=50&limit=500`;
            } else {
                urlWithDate = `${url}?dates=${dateStr}`;
            }
            
            console.log(`Fetching ${sport}: ${urlWithDate} (EST date: ${dateStr})`);
            
            const response = await fetch(urlWithDate);
            
            if (!response.ok) {
                throw new Error(`ESPN API Error: ${response.status} - ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log(`${sport}: Found ${data.events?.length || 0} games (today only in EST)`);
            return data;
        }
        
        // NCAA Football: Fetch without date filter to get all current games (live + upcoming)
        if (sport === 'americanfootball_ncaaf') {
            console.log(`Fetching ${sport}: ${url} (no date filter - gets current bowl games)`);
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`ESPN API Error: ${response.status} - ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log(`${sport}: Found ${data.events?.length || 0} games`);
            return data;
        }
        
        // For other sports (NFL, MLB), use date range
        const estDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const endDate = new Date(estDate);
        endDate.setDate(estDate.getDate() + 14);
        
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}${month}${day}`;
        };
        
        const datesParam = `${formatDate(estDate)}-${formatDate(endDate)}`;
        const urlWithParams = `${url}?dates=${datesParam}`;
        
        console.log(`Fetching ${sport}: ${urlWithParams}`);

        const response = await fetch(urlWithParams);
        
        if (!response.ok) {
            throw new Error(`ESPN API Error: ${response.status} - ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log(`${sport}: Found ${data.events?.length || 0} games`);
        
        return data;
    } catch (error) {
        console.error(`Error fetching ESPN data for ${sport}:`, error.message);
        return { events: [] };
    }
}

async function fetchAllGamesData() {
    const gamesData = [];
    
    for (const [sportKey, sportName] of Object.entries(SPORT_NAMES)) {
        try {
            const data = await fetchESPNData(sportKey);
            const games = parseESPNGames(data, sportKey, sportName);
            gamesData.push(...games);
        } catch (error) {
            console.error(`Error processing ${sportKey}:`, error.message);
        }
    }
    
    return gamesData;
}

function parseESPNGames(data, sportKey, sportName) {
    const games = [];
    
    if (!data.events || data.events.length === 0) {
        return games;
    }

    data.events.forEach(event => {
        try {
            const competition = event.competitions[0];
            const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
            const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
            
            // Skip games with placeholder team names
            const homeTeamName = homeTeam?.team?.displayName || '';
            const awayTeamName = awayTeam?.team?.displayName || '';
            
            if (!homeTeamName || !awayTeamName || 
                homeTeamName.includes('TBD') || awayTeamName.includes('TBD') ||
                homeTeamName.includes('Winner') || awayTeamName.includes('Winner') ||
                homeTeamName.includes('Loser') || awayTeamName.includes('Loser')) {
                return;
            }

            // Get odds/totals if available
            let totalLine = null;
            let bookmaker = null;
            
            if (competition.odds && competition.odds.length > 0) {
                const odds = competition.odds[0];
                bookmaker = odds.provider?.name;
                totalLine = odds.overUnder || null;
            }

            // Determine game status
            let status = 'scheduled';
            if (event.status?.type?.completed) {
                status = 'final';
            } else if (event.status?.type?.state === 'in') {
                status = 'live';
            }

            // Get period and clock for live games - try multiple paths
            let period = null;
            let clock = null;
            
            if (status === 'live') {
                // Try competition.status first (most common)
                period = competition.status?.period || event.status?.period || null;
                clock = competition.status?.displayClock || event.status?.displayClock || null;
                
                // Enhanced debugging for NCAA Football
                if (sportKey === 'americanfootball_ncaaf') {
                    console.log(`NCAA FOOTBALL LIVE: ${awayTeamName} vs ${homeTeamName}`);
                    console.log(`  Period: ${period} (from competition.status.period: ${competition.status?.period}, event.status.period: ${event.status?.period})`);
                    console.log(`  Clock: ${clock} (from competition.status.displayClock: ${competition.status?.displayClock}, event.status.displayClock: ${event.status?.displayClock})`);
                    console.log(`  Status Detail: ${event.status?.type?.detail}`);
                    console.log(`  Competition Status:`, competition.status);
                } else if (period) {
                    console.log(`${sportKey} - ${awayTeamName} vs ${homeTeamName}: Period ${period}, Clock: ${clock || 'N/A'}`);
                }
            }

            games.push({
                id: event.id,
                sport: sportKey,
                sportName: sportName,
                homeTeam: homeTeamName,
                awayTeam: awayTeamName,
                homeTeamLogo: homeTeam?.team?.logo || null,
                awayTeamLogo: awayTeam?.team?.logo || null,
                commence_time: event.date,
                totalLine: totalLine,
                bookmaker: bookmaker,
                homeScore: parseInt(homeTeam?.score) || 0,
                awayScore: parseInt(awayTeam?.score) || 0,
                completed: event.status?.type?.completed || false,
                status: status,
                period: period,
                clock: clock,
                statusDetail: event.status?.type?.detail || null  // Add more status info
            });
        } catch (error) {
            console.error('Error parsing game:', error);
        }
    });
    
    return games;
}

// ===========================================
// DETAILED STATS FOR INDIVIDUAL GAMES
// ===========================================

async function fetchGameStats(game) {
    try {
        const espnUrl = ESPN_ENDPOINTS[game.sport];
        if (!espnUrl) {
            console.log(`No ESPN endpoint for sport: ${game.sport}`);
            return null;
        }

        const response = await fetch(espnUrl);
        if (!response.ok) {
            throw new Error(`ESPN API Error: ${response.status}`);
        }

        const data = await response.json();
        
        // Find the matching game by team names
        const espnGame = data.events?.find(event => {
            const homeTeam = event.competitions[0].competitors.find(c => c.homeAway === 'home');
            const awayTeam = event.competitions[0].competitors.find(c => c.homeAway === 'away');
            
            return (
                homeTeam?.team?.displayName === game.homeTeam &&
                awayTeam?.team?.displayName === game.awayTeam
            ) || (
                homeTeam?.team?.name === game.homeTeam &&
                awayTeam?.team?.name === game.awayTeam
            );
        });

        if (!espnGame) {
            console.log(`Could not find matching ESPN game for ${game.awayTeam} vs ${game.homeTeam}`);
            return null;
        }

        // Extract detailed stats
        const competition = espnGame.competitions[0];
        const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
        const awayTeam = competition.competitors.find(c => c.homeAway === 'away');

        return {
            gameId: espnGame.id,
            status: {
                type: espnGame.status?.type?.name,
                detail: espnGame.status?.type?.detail,
                period: competition.status?.period,
                clock: competition.status?.displayClock
            },
            teams: {
                home: {
                    id: homeTeam.id,
                    name: homeTeam.team.displayName,
                    logo: homeTeam.team.logo,
                    score: homeTeam.score,
                    record: homeTeam.records?.[0]?.summary,
                    leaders: homeTeam.leaders || [],
                    statistics: homeTeam.statistics || []
                },
                away: {
                    id: awayTeam.id,
                    name: awayTeam.team.displayName,
                    logo: awayTeam.team.logo,
                    score: awayTeam.score,
                    record: awayTeam.records?.[0]?.summary,
                    leaders: awayTeam.leaders || [],
                    statistics: awayTeam.statistics || []
                }
            },
            situation: competition.situation || null,
            headlines: espnGame.competitions[0].headlines || [],
            venue: competition.venue
        };
    } catch (error) {
        console.error('Error fetching ESPN stats:', error);
        return null;
    }
}

// ===========================================
// COLLEGE BASKETBALL DATA API FUNCTIONS
// ===========================================

async function fetchCBBTeamHistory(teamId) {
    // Use cached data if available
    if (ncaabCache) {
        try {
            const teamsData = await fetchAllTeams();
            const team = teamsData.find(t => t.id === teamId && t.sport === 'basketball_ncaab');
            
            if (!team) {
                console.log(`Team ${teamId} not found`);
                return null;
            }

            console.log(`📦 Looking up cached data for ${team.name} (ESPN ID: ${teamId})`);

            // Try to get CBB API team ID from mapping
            const cbbTeamId = teamIdMapping.get(String(teamId));
            
            if (!cbbTeamId) {
                console.log(`   No ID mapping found for ESPN ID ${teamId}`);
                return null;
            }
            
            console.log(`   Mapped to CBB API ID: ${cbbTeamId}`);
            
            // Initialize as empty array
            let allGames = [];
            
            // Cache should be an array of games
            if (Array.isArray(ncaabCache)) {
                console.log(`   Searching through ${ncaabCache.length} cached games...`);
                allGames = ncaabCache.filter(game => 
                    String(game.homeTeamId) === String(cbbTeamId) || 
                    String(game.awayTeamId) === String(cbbTeamId)
                );
            } else {
                console.log(`   ⚠️  Cache is not an array, structure: ${typeof ncaabCache}`);
                return null;
            }
            
            if (allGames.length === 0) {
                console.log(`   No games found for CBB team ID ${cbbTeamId}`);
                return null;
            }
            
            // Sort by date (most recent first)
            allGames.sort((a, b) => {
                const dateA = new Date(a.startDate || a.start_date || a.date);
                const dateB = new Date(b.startDate || b.start_date || b.date);
                return dateB - dateA;
            });
            
            console.log(`   Found ${allGames.length} total games for this team`);

            // Create a reverse mapping (CBB ID -> ESPN ID) to get opponent logos
            const cbbToEspnMap = new Map();
            for (const [espnId, cbbId] of teamIdMapping.entries()) {
                cbbToEspnMap.set(cbbId, espnId);
            }

            // Return ALL games found
            return allGames.map(game => {
                const isHome = String(game.homeTeamId) === String(cbbTeamId);
                const homeScore = parseInt(game.homePoints) || 0;
                const awayScore = parseInt(game.awayPoints) || 0;
                const teamScore = isHome ? homeScore : awayScore;

                // Get opponent's ESPN ID to find their logo
                const opponentCbbId = isHome ? String(game.awayTeamId) : String(game.homeTeamId);
                const opponentEspnId = cbbToEspnMap.get(opponentCbbId);
                const opponentTeam = opponentEspnId ? teamsData.find(t => 
                    t.id === opponentEspnId && t.sport === 'basketball_ncaab'
                ) : null;

                return {
                    date: game.startDate || game.date,
                    homeTeam: {
                        name: game.homeTeam,
                        logo: isHome ? team.logo : (opponentTeam?.logo || null),
                        score: homeScore
                    },
                    awayTeam: {
                        name: game.awayTeam,
                        logo: !isHome ? team.logo : (opponentTeam?.logo || null),
                        score: awayScore
                    },
                    total: homeScore + awayScore,
                    teamScore: teamScore // The selected team's score
                };
            });
        } catch (error) {
            console.error('Error using cached data:', error);
            console.error('Stack:', error.stack);
            return null;
        }
    }

    console.log('⚠️  No cache available');
    return null;
}

async function fetchNCAAFTeamHistory(teamId) {
    // Use cached data if available
    if (ncaafCache) {
        try {
            const teamsData = await fetchAllTeams();
            const team = teamsData.find(t => t.id === teamId && t.sport === 'americanfootball_ncaaf');
            
            if (!team) {
                console.log(`Team ${teamId} not found`);
                return null;
            }

            console.log(`📦 Looking up cached data for ${team.name} (ID: ${teamId})`);

            // Try exact match first
            let teamGames = ncaafCache[team.name] || [];
            
            // If no exact match, try fuzzy matching
            if (teamGames.length === 0) {
                const teamNameLower = team.name.toLowerCase();
                const teamNameWords = teamNameLower.split(' ');
                
                for (const cachedTeamName of Object.keys(ncaafCache)) {
                    const cachedLower = cachedTeamName.toLowerCase();
                    
                    const firstWord = teamNameWords[0];
                    if (cachedLower.includes(firstWord) && firstWord.length > 3) {
                        console.log(`Found fuzzy match: "${team.name}" -> "${cachedTeamName}"`);
                        teamGames = ncaafCache[cachedTeamName];
                        break;
                    }
                }
            }
            
            if (teamGames.length === 0) {
                console.log(`No cached games found for ${team.name}`);
                return null;
            }

            const last3 = teamGames.slice(0, 3);
            console.log(`Found ${last3.length} cached games for ${team.name}`);

            return last3.map(game => {
                const isHome = game.isHome === true;
                const homeScore = parseInt(game.homePoints) || 0;
                const awayScore = parseInt(game.awayPoints) || 0;

                return {
                    date: game.startDate || game.date,
                    homeTeam: {
                        name: game.homeTeam,
                        logo: isHome ? team.logo : null,
                        score: homeScore
                    },
                    awayTeam: {
                        name: game.awayTeam,
                        logo: !isHome ? team.logo : null,
                        score: awayScore
                    },
                    total: homeScore + awayScore
                };
            });
        } catch (error) {
            console.error('Error using cached data:', error);
            return null;
        }
    }

    console.log('⚠️  No cache available');
    return null;
}

// ===========================================
// HELPER FUNCTIONS FOR TEAMS AND HISTORY
// ===========================================

async function fetchAllTeams() {
    const allTeams = [];
    const teamsEndpoints = {
        'basketball_nba': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams',
        'americanfootball_nfl': 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams',
        'basketball_ncaab': 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=400',
        'americanfootball_ncaaf': 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=200'
    };

    for (const [sport, url] of Object.entries(teamsEndpoints)) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            
            const data = await response.json();
            const teams = data.sports?.[0]?.leagues?.[0]?.teams || [];
            
            teams.forEach(teamObj => {
                const team = teamObj.team;
                if (team) {
                    allTeams.push({
                        id: team.id,
                        name: team.displayName || team.name,
                        logo: team.logos?.[0]?.href || team.logo,
                        sport: sport
                    });
                }
            });
        } catch (error) {
            console.error(`Error fetching teams for ${sport}:`, error.message);
        }
    }

    return allTeams;
}

async function fetchTeamHistory(teamId, sport) {
    try {
        // Get team info first
        const teamsData = await fetchAllTeams();
        const team = teamsData.find(t => t.id === teamId && t.sport === sport);
        
        if (!team) {
            throw new Error('Team not found');
        }

        console.log(`Fetching history for team: ${team.name} (ID: ${teamId}) - Sport: ${sport}`);

        // For NCAA Basketball, use cache only
        if (sport === 'basketball_ncaab') {
            const cbbGames = await fetchCBBTeamHistory(teamId);
            if (cbbGames && cbbGames.length > 0) {
                console.log(`Retrieved ${cbbGames.length} games from NCAA Basketball cache`);
                return {
                    team: team,
                    games: cbbGames
                };
            }
            console.log('No cached data available for NCAA Basketball');
            return {
                team: team,
                games: []
            };
        }

        // For NCAA Football, use cache only
        if (sport === 'americanfootball_ncaaf') {
            const ncaafGames = await fetchNCAAFTeamHistory(teamId);
            if (ncaafGames && ncaafGames.length > 0) {
                console.log(`Retrieved ${ncaafGames.length} games from NCAA Football cache`);
                return {
                    team: team,
                    games: ncaafGames
                };
            }
            console.log('No cached data available for NCAA Football');
            return {
                team: team,
                games: []
            };
        }

        // For other sports (NBA, NFL), use ESPN API
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 90);
        
        const formatDate = (date) => {
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            return `${year}${month}${day}`;
        };
        
        const datesParam = `${formatDate(startDate)}-${formatDate(today)}`;
        const url = `${ESPN_ENDPOINTS[sport]}?dates=${datesParam}`;
        
        console.log(`Fetching games from: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`ESPN API Error: ${response.status}`);
        }
        
        const data = await response.json();
        
        console.log(`Total events found: ${data.events?.length || 0}`);
        
        // Filter for completed games involving this team
        const teamGames = [];
        if (data.events) {
            for (const event of data.events) {
                // Only include completed games
                if (!event.status?.type?.completed) {
                    continue;
                }
                
                const competition = event.competitions[0];
                const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
                const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
                
                // Check if this game involves our team (compare as strings to handle type differences)
                const homeTeamId = String(homeTeam?.team?.id || homeTeam?.id);
                const awayTeamId = String(awayTeam?.team?.id || awayTeam?.id);
                const searchTeamId = String(teamId);
                
                if (homeTeamId === searchTeamId || awayTeamId === searchTeamId) {
                    const homeScore = parseInt(homeTeam?.score) || 0;
                    const awayScore = parseInt(awayTeam?.score) || 0;
                    
                    console.log(`Found game: ${awayTeam?.team?.displayName} @ ${homeTeam?.team?.displayName} (${event.date})`);
                    
                    teamGames.push({
                        date: event.date,
                        homeTeam: {
                            name: homeTeam?.team?.displayName || homeTeam?.team?.name,
                            logo: homeTeam?.team?.logo,
                            score: homeScore
                        },
                        awayTeam: {
                            name: awayTeam?.team?.displayName || awayTeam?.team?.name,
                            logo: awayTeam?.team?.logo,
                            score: awayScore
                        },
                        total: homeScore + awayScore
                    });
                }
            }
        }
        
        console.log(`Found ${teamGames.length} completed games for this team`);
        
        // Sort by date (most recent first) and take last 3
        teamGames.sort((a, b) => new Date(b.date) - new Date(a.date));
        const last3Games = teamGames.slice(0, 3);
        
        console.log(`Returning ${last3Games.length} most recent games`);
        
        return {
            team: team,
            games: last3Games
        };
    } catch (error) {
        console.error('Error fetching team history:', error);
        throw error;
    }
}

// ===========================================
// START SERVER
// ===========================================

app.listen(PORT, async () => {
    console.log(`
╔════════════════════════════════════════════╗
║   Matt's Betting Tools                     ║
║   Running on http://localhost:${PORT}       ║
║   Using ESPN API (FREE - No key needed!)   ║
╚════════════════════════════════════════════╝
    `);

    // Load team ID mapping first
    console.log('\n📋 Loading team ID mappings...');
    await loadTeamIdMapping();

    // Initialize NCAA Basketball cache
    console.log('\n🏀 Initializing NCAA Basketball cache...');
    const ncaabCacheLoaded = await loadCacheFromDisk('basketball');
    
    if (!ncaabCacheLoaded) {
        console.log('No existing basketball cache, downloading fresh data...');
        await downloadAllNCAABData();
    } else {
        const cacheAge = Date.now() - lastNCAABCacheUpdate.getTime();
        const hoursOld = cacheAge / (1000 * 60 * 60);
        
        if (hoursOld > 24) {
            console.log(`Basketball cache is ${Math.round(hoursOld)} hours old, refreshing...`);
            await downloadAllNCAABData();
        } else {
            console.log(`Basketball cache is ${Math.round(hoursOld)} hours old, using existing data`);
        }
    }

    // Initialize NCAA Football cache
    console.log('\n🏈 Initializing NCAA Football cache...');
    const ncaafCacheLoaded = await loadCacheFromDisk('football');
    
    if (!ncaafCacheLoaded) {
        console.log('No existing football cache, downloading fresh data...');
        await downloadAllNCAAFData();
    } else {
        const cacheAge = Date.now() - lastNCAAFCacheUpdate.getTime();
        const hoursOld = cacheAge / (1000 * 60 * 60);
        
        if (hoursOld > 24) {
            console.log(`Football cache is ${Math.round(hoursOld)} hours old, refreshing...`);
            await downloadAllNCAAFData();
        } else {
            console.log(`Football cache is ${Math.round(hoursOld)} hours old, using existing data`);
        }
    }
    
    // Schedule daily updates at 2 AM EST for both sports
    scheduleNCAAUpdates();
    
    console.log('\n✅ Server ready!\n');
});