# Live O/U Tracker

A real-time sports over/under tracking website that displays live odds and projected totals for MLB, NFL, NCAA Basketball, and NCAA Football games.

## 🔒 SECURE ARCHITECTURE

This application uses a **Node.js backend server** to keep your API key secure and hidden from public view. Your API key never gets exposed to users visiting your website.

## Features

- **Live Game Tracking**: Real-time scores and over/under lines
- **Projected Totals**: Calculates projected final totals based on current game pace
- **Multi-Sport Support**: MLB, NFL, NCAA Men's Basketball, NCAA Men's Football
- **Clean Interface**: Terminal-inspired design with live updates every 30 seconds
- **No Login Required**: Pure data display without any authentication
- **Secure API Key**: Backend server protects your API credentials

## Project Structure

```
live-ou-tracker/
├── server.js           # Backend server (keeps API key secure)
├── package.json        # Node.js dependencies
├── .env               # Your API key (NEVER commit this!)
├── .env.example       # Template for .env file
├── .gitignore         # Prevents committing secrets
└── public/
    └── index.html     # Frontend website
```

## Setup Instructions

### 1. Get Your API Key

1. Visit [https://the-odds-api.com](https://the-odds-api.com)
2. Sign up for a free account
3. Get your API key from the dashboard
4. Free tier includes 500 requests per month

### 2. Install Node.js

If you don't have Node.js installed:
1. Visit [https://nodejs.org](https://nodejs.org)
2. Download and install the LTS version (v18 or higher)

### 3. Local Setup

```bash
# 1. Navigate to the project folder
cd live-ou-tracker

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env

# 4. Edit .env and add your API key
# Open .env in a text editor and replace:
# ODDS_API_KEY=your_api_key_here
# with your actual API key

# 5. Start the server
npm start
```

Visit `http://localhost:3000` in your browser!

### 4. Testing Locally

The server should display:
```
╔════════════════════════════════════════════╗
║   Live O/U Tracker Server                  ║
║   Running on http://localhost:3000         ║
╚════════════════════════════════════════════╝

API Key Configured: ✓ Yes
```

If you see "✗ No", check your `.env` file.

## API Information

### The Odds API

- **Base URL**: `https://api.the-odds-api.com/v4`
- **Endpoints Used**:
  - `/sports/{sport}/odds` - Get current odds and totals lines
  - `/sports/{sport}/scores` - Get live scores
- **Sports Keys**:
  - `baseball_mlb` - Major League Baseball
  - `americanfootball_nfl` - National Football League
  - `basketball_ncaab` - NCAA Men's Basketball
  - `americanfootball_ncaaf` - NCAA Football

### Rate Limits

- Free tier: 500 requests per month
- The site makes 8 API calls every 30 seconds (4 sports × 2 endpoints)
- This equals approximately 11,520 requests per month
- **Recommendation**: Upgrade to paid tier ($20/month for 10,000 requests) for continuous operation

## Customization

### Changing Update Frequency

Find this line (around line 685):

```javascript
}, 30000); // 30 seconds
```

Change `30000` to adjust the refresh interval (in milliseconds):
- 60000 = 1 minute
- 120000 = 2 minutes

### Adding More Sports

The Odds API supports many sports. To add more, update the `SPORTS` object:

```javascript
const SPORTS = {
    'basketball_nba': { name: 'NBA', season: 'October-June' },
    'icehockey_nhl': { name: 'NHL', season: 'October-June' },
    // ... add more sports
};
```

### Changing Colors

All colors are defined in CSS variables at the top of the file. Modify these values:

```css
:root {
    --bg-primary: #0a0e14;
    --accent-cyan: #06b6d4;
    /* ... other colors */
}
```

## Troubleshooting

### "API Key Required" Message

- Make sure you've replaced `YOUR_API_KEY_HERE` with your actual API key
- Check that there are no extra spaces or quotes

### "Error loading games" Message

- Check browser console (F12) for detailed error messages
- Verify your API key is valid and active
- Check if you've exceeded your API rate limit
- Ensure you have an active internet connection

### Games Not Showing

- Some sports are seasonal - games may not be available
- Check The Odds API dashboard to verify available games
- Try filtering by a specific sport to narrow down the issue

### CORS Errors

- This typically happens when testing locally
- Use a local server (see Testing Locally section above)
- Once deployed to a real domain, CORS should not be an issue

## Performance Optimization

To reduce API usage:

1. **Increase Refresh Interval**: Change from 30 seconds to 60+ seconds
2. **Cache Data**: Implement local storage caching
3. **Conditional Updates**: Only fetch data for the currently selected sport
4. **Peak Hours Only**: Only auto-refresh during actual game times

## Support

For API issues:
- The Odds API Documentation: https://the-odds-api.com/liveapi/guides/v4/
- Contact: support@the-odds-api.com

For deployment help:
- GoDaddy Support: https://www.godaddy.com/help

## License

This website is provided as-is for personal use. The Odds API data is subject to their terms of service.

## Future Enhancements

Potential improvements you could add:

- Historical data tracking
- More sophisticated pace calculations based on game time/inning/quarter
- Push notifications for significant pace changes
- Filtering by odds movement
- Multiple sportsbook comparison
- Mobile app version
- Betting trend analysis

## Deployment Options

### Option 1: Heroku (Recommended - Easy & Free Tier Available)

Heroku is perfect for Node.js apps and keeps your API key secure.

```bash
# 1. Install Heroku CLI
# Download from: https://devcenter.heroku.com/articles/heroku-cli

# 2. Login to Heroku
heroku login

# 3. Create a new Heroku app
heroku create your-app-name

# 4. Set your API key as an environment variable (SECURE!)
heroku config:set ODDS_API_KEY=your_actual_api_key_here

# 5. Deploy
git init
git add .
git commit -m "Initial commit"
git push heroku main

# 6. Open your app
heroku open
```

**Point your GoDaddy domain to Heroku:**
1. In Heroku dashboard, go to Settings > Domains
2. Add your custom domain
3. Heroku will give you a DNS target
4. In GoDaddy DNS settings, add a CNAME record pointing to the Heroku DNS target

**Cost**: Free tier available (sleeps after 30 min of inactivity)

### Option 2: Railway (Modern Alternative)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and initialize
railway login
railway init

# Add environment variable
railway variables set ODDS_API_KEY=your_actual_api_key_here

# Deploy
railway up
```

**Cost**: $5/month

### Option 3: DigitalOcean App Platform

1. Push code to GitHub (ensure .env is in .gitignore!)
2. Create app from GitHub repo at https://cloud.digitalocean.com/apps
3. Add environment variable ODDS_API_KEY in dashboard
4. Deploy and connect your domain

**Cost**: $5/month

### Option 4: VPS (Full Control - DigitalOcean, Linode, Vultr)

```bash
# SSH into server
ssh root@your-server-ip

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
npm install -g pm2

# Clone your repo and setup
cd /var/www
git clone your-repo
cd your-repo
npm install

# Create .env file
echo "ODDS_API_KEY=your_actual_api_key" > .env

# Start with PM2
pm2 start server.js --name "ou-tracker"
pm2 startup
pm2 save

# Install Nginx
sudo apt install nginx

# Configure Nginx
sudo tee /etc/nginx/sites-available/default > /dev/null <<EON
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EON

# Restart Nginx
sudo systemctl restart nginx

# Install SSL
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

**Cost**: $5-10/month

## Connecting Your GoDaddy Domain

### For Heroku/Railway/DigitalOcean:
1. Log into GoDaddy DNS Management
2. Add CNAME record:
   - Type: CNAME
   - Name: www (or @ for root)
   - Value: your-app.herokuapp.com
   - TTL: 1 hour

### For VPS (with IP address):
1. Add A record:
   - Type: A
   - Name: @
   - Value: your.server.ip.address
   - TTL: 1 hour

## Important Security Notes

⚠️ **NEVER commit your .env file to Git!**
- The .gitignore file prevents this
- Always use environment variables on production servers
- Never share your API key publicly

## API Usage & Rate Limits

- Free tier: 500 requests/month
- App makes 8 API calls every 30 seconds (4 sports × 2 endpoints)
- Estimated usage: ~11,520 requests/month
- **Recommendation**: Upgrade to paid tier ($20/month for 10,000 requests)

To reduce API usage:
- Increase refresh interval in public/index.html
- Implement caching on the server
- Only fetch data for active sports seasons

## Troubleshooting

### "API Key not configured" error
- Check your .env file exists
- Verify ODDS_API_KEY is set correctly
- Restart the server after changing .env

### "Connection Error" in browser
- Ensure server is running on correct port
- Check firewall settings
- Verify API key is valid

### Games not showing
- Some sports are seasonal
- Check The Odds API dashboard for available games
- Verify you haven't exceeded rate limits

## Customization

### Change update frequency
In `public/index.html`, find:
```javascript
setInterval(loadGames, 30000); // 30 seconds
```
Change to 60000 for 1 minute, etc.

### Add more sports
In `server.js`, update SPORTS array:
```javascript
const SPORTS = [
    'basketball_nba',
    'icehockey_nhl',
    // ... more sports
];
```

### Change colors
In `public/index.html`, modify CSS variables:
```css
:root {
    --accent-cyan: #06b6d4;
    /* ... other colors */
}
```

## Support

- The Odds API Documentation: https://the-odds-api.com/liveapi/guides/v4/
- The Odds API Support: support@the-odds-api.com

## License

This website is provided as-is for personal use. The Odds API data is subject to their terms of service.
