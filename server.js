// server.js - Backend server using ESPN's FREE API (no API key needed!)
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`ESPN API Error: ${response.status} - ${response.statusText}`);
        }
        
        return await response.json();
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
// START SERVER
// ===========================================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║   Live O/U Tracker Server                  ║
║   Running on http://localhost:${PORT}       ║
║   Using ESPN API (FREE - No key needed!)   ║
╚════════════════════════════════════════════╝
    `);
});
