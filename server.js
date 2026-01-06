// server.js - Backend server to keep API key secure
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from 'public' folder

// Configuration
const API_KEY = process.env.ODDS_API_KEY; // API key stored in environment variable
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Sports configuration
const SPORTS = ['baseball_mlb', 'americanfootball_nfl', 'basketball_ncaab', 'americanfootball_ncaaf'];

// ===========================================
// API ENDPOINTS
// ===========================================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        apiConfigured: !!API_KEY 
    });
});

// Main endpoint to get all games data - ALWAYS LIVE, NO CACHE
app.get('/api/games', async (req, res) => {
    try {
        // Check if API key is configured
        if (!API_KEY) {
            return res.status(500).json({ 
                error: 'API key not configured',
                message: 'Please set ODDS_API_KEY in your .env file'
            });
        }

        // Always fetch fresh data - no caching
        console.log('Fetching live data from API...');
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

// New endpoint for individual game details with stats
app.get('/api/game/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;
        
        if (!API_KEY) {
            return res.status(500).json({ 
                error: 'API key not configured',
                message: 'Please set ODDS_API_KEY in your .env file'
            });
        }

        console.log(`Fetching details for game ${gameId}...`);
        
        // Get basic game data from The Odds API
        const allGames = await fetchAllGamesData();
        const game = allGames.find(g => g.id === gameId);
        
        if (!game) {
            return res.status(404).json({ 
                error: 'Game not found',
                message: `No game found with ID: ${gameId}`
            });
        }

        // Fetch detailed stats from ESPN API
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
// HELPER FUNCTIONS
// ===========================================

async function fetchOddsData(sport) {
    try {
        const response = await fetch(
            `${ODDS_API_BASE}/sports/${sport}/odds/?apiKey=${API_KEY}&regions=us&markets=totals&oddsFormat=american`
        );
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status} - ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error(`Error fetching odds for ${sport}:`, error.message);
        return [];
    }
}

async function fetchScoresData(sport) {
    try {
        const response = await fetch(
            `${ODDS_API_BASE}/sports/${sport}/scores/?apiKey=${API_KEY}&daysFrom=1`
        );
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status} - ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error(`Error fetching scores for ${sport}:`, error.message);
        return [];
    }
}

async function fetchAllGamesData() {
    const gamesData = [];
    
    const sportNames = {
        'baseball_mlb': 'MLB',
        'americanfootball_nfl': 'NFL',
        'basketball_ncaab': 'NCAA Basketball',
        'americanfootball_ncaaf': 'NCAA Football'
    };
    
    for (const sport of SPORTS) {
        try {
            const [odds, scores] = await Promise.all([
                fetchOddsData(sport),
                fetchScoresData(sport)
            ]);
            
            const mergedGames = mergeGameData(odds, scores, sport, sportNames[sport]);
            gamesData.push(...mergedGames);
        } catch (error) {
            console.error(`Error processing ${sport}:`, error.message);
        }
    }
    
    return gamesData;
}

function mergeGameData(oddsData, scoresData, sportKey, sportName) {
    const games = [];
    
    // Create a map of scores by game ID
    const scoresMap = new Map();
    scoresData.forEach(game => {
        scoresMap.set(game.id, game);
    });
    
    oddsData.forEach(oddsGame => {
        const scoreGame = scoresMap.get(oddsGame.id);
        
        // Filter out hypothetical/placeholder games
        // Check if teams have generic/placeholder names
        const homeTeam = oddsGame.home_team || '';
        const awayTeam = oddsGame.away_team || '';
        
        // Skip games with placeholder team names or missing critical data
        if (!homeTeam || !awayTeam || 
            homeTeam.includes('TBD') || awayTeam.includes('TBD') ||
            homeTeam.includes('Winner') || awayTeam.includes('Winner') ||
            homeTeam.includes('Loser') || awayTeam.includes('Loser')) {
            return; // Skip this game
        }
        
        // Get the best totals line
        let totalLine = null;
        let bookmaker = null;
        if (oddsGame.bookmakers && oddsGame.bookmakers.length > 0) {
            bookmaker = oddsGame.bookmakers[0].title;
            const totalsMarket = oddsGame.bookmakers[0].markets.find(m => m.key === 'totals');
            if (totalsMarket && totalsMarket.outcomes.length > 0) {
                totalLine = parseFloat(totalsMarket.outcomes[0].point);
            }
        }
        
        games.push({
            id: oddsGame.id,
            sport: sportKey,
            sportName: sportName,
            homeTeam: homeTeam,
            awayTeam: awayTeam,
            commence_time: oddsGame.commence_time,
            totalLine: totalLine,
            bookmaker: bookmaker,
            homeScore: scoreGame?.scores?.find(s => s.name === homeTeam)?.score || 0,
            awayScore: scoreGame?.scores?.find(s => s.name === awayTeam)?.score || 0,
            completed: scoreGame?.completed || false,
            status: scoreGame?.completed ? 'final' : (scoreGame?.scores ? 'live' : 'scheduled')
        });
    });
    
    return games;
}

// ===========================================
// ESPN API INTEGRATION FOR DETAILED STATS
// ===========================================

// Map sport keys to ESPN API endpoints
const ESPN_ENDPOINTS = {
    'baseball_mlb': 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
    'americanfootball_nfl': 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
    'basketball_ncaab': 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
    'americanfootball_ncaaf': 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard'
};

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
╚════════════════════════════════════════════╝

API Key Configured: ${API_KEY ? '✓ Yes' : '✗ No - Please add to .env file'}
    `);
});
