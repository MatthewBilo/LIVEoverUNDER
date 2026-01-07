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

// Cache configuration
const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'ncaab_games.json');
let ncaabCache = null;
let lastCacheUpdate = null;

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
// CACHE MANAGEMENT FOR NCAA BASKETBALL
// ===========================================

async function ensureCacheDir() {
    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (err) {
        console.error('Error creating cache directory:', err);
    }
}

async function loadCacheFromDisk() {
    try {
        const data = await fs.readFile(CACHE_FILE, 'utf8');
        const parsed = JSON.parse(data);
        ncaabCache = parsed.data;
        lastCacheUpdate = new Date(parsed.timestamp);
        console.log(`✅ Loaded NCAA Basketball cache from disk (${lastCacheUpdate.toLocaleString()})`);
        return true;
    } catch (err) {
        console.log('No cache file found or error reading cache');
        return false;
    }
}

async function saveCacheToDisk() {
    try {
        await ensureCacheDir();
        const cacheData = {
            timestamp: new Date().toISOString(),
            data: ncaabCache
        };
        await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
        console.log('✅ Saved NCAA Basketball cache to disk');
    } catch (err) {
        console.error('Error saving cache to disk:', err);
    }
}

async function downloadAllNCAABData() {
    if (!CBB_API_KEY) {
        console.log('⚠️  CBB_API_KEY not configured, skipping NCAA Basketball cache update');
        return;
    }

    console.log('🔄 Downloading NCAA Basketball data from CollegeBasketballData.com...');

    try {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        
        // College basketball season format: use the END year of the season
        const season = currentMonth < 6 ? currentYear : currentYear + 1;

        // Get games from the last 3 weeks
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 21); // 3 weeks ago

        // Format dates as ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ)
        const startDateStr = startDate.toISOString();
        const endDateStr = endDate.toISOString();

        // Use /games endpoint with date range and season filter
        const url = `https://api.collegebasketballdata.com/games?season=${season}&startDateRange=${encodeURIComponent(startDateStr)}&endDateRange=${encodeURIComponent(endDateStr)}`;
        
        console.log(`Fetching games for season ${season}`);
        console.log(`Date range: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`);

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

        console.log(`✅ Downloaded ${data.length} games from CBB API (last 3 weeks)`);

        // Filter for completed games only (status = 'final' and has scores)
        const completedGames = data.filter(game => {
            // Check if game has final status and both teams have scores
            const hasScores = game.homePoints != null && game.awayPoints != null;
            const isCompleted = game.status === 'final' || game.status === 'Final';
            return hasScores && isCompleted;
        });

        console.log(`✅ ${completedGames.length} completed games`);

        // Organize by team for faster lookups
        // Each game appears twice (once for home team, once for away team)
        const gamesByTeam = {};
        
        completedGames.forEach(game => {
            const homeTeam = game.homeTeam;
            const awayTeam = game.awayTeam;
            
            // Add to home team's list
            if (homeTeam) {
                if (!gamesByTeam[homeTeam]) {
                    gamesByTeam[homeTeam] = [];
                }
                gamesByTeam[homeTeam].push({
                    ...game,
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
                    ...game,
                    isHome: false,
                    opponent: homeTeam
                });
            }
        });

        // Sort each team's games by date (most recent first)
        Object.keys(gamesByTeam).forEach(teamName => {
            gamesByTeam[teamName].sort((a, b) => {
                const dateA = new Date(a.startDate || a.start_date || a.date);
                const dateB = new Date(b.startDate || b.start_date || b.date);
                return dateB - dateA;
            });
        });

        ncaabCache = gamesByTeam;
        lastCacheUpdate = new Date();

        await saveCacheToDisk();

        console.log(`✅ NCAA Basketball cache updated successfully at ${lastCacheUpdate.toLocaleString()}`);
        console.log(`   Cached data for ${Object.keys(gamesByTeam).length} teams`);
    } catch (error) {
        console.error('❌ Error downloading NCAA Basketball data:', error.message);
    }
}

function scheduleNCAABCacheUpdate() {
    // Calculate milliseconds until next 2 AM EST
    function getNextUpdateTime() {
        const now = new Date();
        const next = new Date(now);
        
        // Convert to EST (UTC-5, or UTC-4 during DST)
        // For simplicity, using UTC-5
        const estOffset = -5 * 60; // -5 hours in minutes
        const nowEST = new Date(now.getTime() + (estOffset + now.getTimezoneOffset()) * 60000);
        
        // Set to 2 AM EST
        next.setHours(2, 0, 0, 0);
        
        // If 2 AM has already passed today, schedule for tomorrow
        if (nowEST.getHours() >= 2) {
            next.setDate(next.getDate() + 1);
        }
        
        return next;
    }

    function scheduleNext() {
        const next = getNextUpdateTime();
        const msUntilNext = next.getTime() - Date.now();
        
        console.log(`📅 Next NCAA Basketball cache update scheduled for ${next.toLocaleString()}`);
        
        setTimeout(async () => {
            await downloadAllNCAABData();
            scheduleNext(); // Schedule next update
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
            const today = new Date();
            const year = today.getUTCFullYear();
            const month = String(today.getUTCMonth() + 1).padStart(2, '0');
            const day = String(today.getUTCDate()).padStart(2, '0');
            const dateStr = `${year}${month}${day}`;
            
            const urlWithDate = `${url}?dates=${dateStr}`;
            console.log(`Fetching ${sport}: ${urlWithDate}`);
            
            const response = await fetch(urlWithDate);
            
            if (!response.ok) {
                throw new Error(`ESPN API Error: ${response.status} - ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log(`${sport}: Found ${data.events?.length || 0} games (today only)`);
            return data;
        }
        
        // For other sports (NFL, NCAA Football, MLB), use date range
        const today = new Date();
        const endDate = new Date(today);
        endDate.setDate(today.getDate() + 14);
        
        const formatDate = (date) => {
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            return `${year}${month}${day}`;
        };
        
        const datesParam = `${formatDate(today)}-${formatDate(endDate)}`;
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
                
                // For debugging - log what we found
                if (period) {
                    console.log(`${sportKey} - ${awayTeamName} vs ${homeTeamName}: Period ${period}, Clock: ${clock || 'N/A'}`);
                }
            }

            games.push({
                id: event.id,
                sport: sportKey,
                sportName: sportName,
                homeTeam: homeTeamName,
                awayTeam: awayTeamName,
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

            console.log(`📦 Looking up cached data for ${team.name} (ID: ${teamId})`);

            // Try exact match first
            let teamGames = ncaabCache[team.name] || [];
            
            // If no exact match, try fuzzy matching
            if (teamGames.length === 0) {
                const teamNameLower = team.name.toLowerCase();
                const teamNameWords = teamNameLower.split(' ');
                
                for (const cachedTeamName of Object.keys(ncaabCache)) {
                    const cachedLower = cachedTeamName.toLowerCase();
                    
                    // Check if main team name matches
                    const firstWord = teamNameWords[0];
                    if (cachedLower.includes(firstWord) && firstWord.length > 3) {
                        console.log(`Found fuzzy match: "${team.name}" -> "${cachedTeamName}"`);
                        teamGames = ncaabCache[cachedTeamName];
                        break;
                    }
                }
            }
            
            if (teamGames.length === 0) {
                console.log(`No cached games found for ${team.name}`);
                return null;
            }

            // Take the 3 most recent games and convert to our format
            const last3 = teamGames.slice(0, 3);

            console.log(`Found ${last3.length} cached games for ${team.name}`);

            return last3.map(game => {
                const isHome = game.isHome === true;
                
                // Use homePoints/awayPoints from /games endpoint
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

        // For NCAA Basketball, use cache only (no ESPN fallback)
        if (sport === 'basketball_ncaab') {
            const cbbGames = await fetchCBBTeamHistory(teamId);
            if (cbbGames && cbbGames.length > 0) {
                console.log(`Retrieved ${cbbGames.length} games from NCAA Basketball cache`);
                return {
                    team: team,
                    games: cbbGames
                };
            }
            // No ESPN fallback - return empty if cache unavailable
            console.log('No cached data available for NCAA Basketball');
            return {
                team: team,
                games: []
            };
        }

        // For other sports (NBA, NFL, NCAA Football), use ESPN API
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

    // Initialize NCAA Basketball cache
    console.log('\n🏀 Initializing NCAA Basketball cache...');
    
    // Try to load existing cache from disk
    const cacheLoaded = await loadCacheFromDisk();
    
    if (!cacheLoaded) {
        console.log('No existing cache found, downloading fresh data...');
        await downloadAllNCAABData();
    } else {
        // Check if cache is stale (older than 24 hours)
        const cacheAge = Date.now() - lastCacheUpdate.getTime();
        const hoursOld = cacheAge / (1000 * 60 * 60);
        
        if (hoursOld > 24) {
            console.log(`Cache is ${Math.round(hoursOld)} hours old, refreshing...`);
            await downloadAllNCAABData();
        } else {
            console.log(`Cache is ${Math.round(hoursOld)} hours old, using existing data`);
        }
    }
    
    // Schedule daily updates at 2 AM EST
    scheduleNCAABCacheUpdate();
    
    console.log('\n✅ Server ready!\n');
});
